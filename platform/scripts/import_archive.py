"""Bulk import of hand-history archives, straight into ClickHouse.

**Why this bypasses Kafka.** The HTTP upload path exists for live, incremental uploads from a
client that must get a 202 in under 200ms; it routes a pointer through Kafka so the API never
blocks on parsing. A 9-million-hand historical backfill has the opposite shape: no latency
requirement, one operator watching it, and enough CPU cost that the interesting parallelism is
process-level rather than partition-level. Pushing it through the bus would add 253 messages,
one consumer's worth of serial throughput, and no benefit. ADR-010's rule still holds — raw
text is written to object storage first, before anything is parsed — so the import remains
re-runnable from the archive alone.

**Idempotency** is inherited, not reimplemented: `hand_uid` is deterministic and every core
table is a ReplacingMergeTree keyed on it, so importing the same archive twice converges to
the same rows. The `uploads` ledger is a *resume* optimization on top of that, not the
correctness mechanism — deleting it and re-running is safe, just slower.

Usage:
    uv run python -m scripts.import_archive PATH... --dataset hero       --email you@example.com
    uv run python -m scripts.import_archive PATH... --dataset population --email you@example.com

`PATH` may be a directory (walked for .txt), a .txt file, or a .zip — including a zip of zips,
which is what PokerCraft's bulk export actually hands you.
"""

from __future__ import annotations

import argparse
import io
import logging
import multiprocessing as mp
import os
import sys
import time
import uuid
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import psycopg
from clickhouse_connect.driver.client import Client

from api.db import clickhouse
from api.settings import get_settings
from core.enums import Site
from ingestion.loader import DATASET_HERO, DATASET_POPULATION
from ingestion.pipeline import ingest_text, record_failures
from ingestion.storage import decode_upload, object_key, put_raw, sha256_of
from parser.base import SiteParser
from parser.registry import get_parser

log = logging.getLogger("import")

TEXT_SUFFIXES = (".txt",)
PROGRESS_EVERY = 1


@dataclass(slots=True, frozen=True)
class SourceFile:
    """One unit of work: a named blob of hand text, wherever it came from."""

    label: str
    """Human-readable provenance, e.g. `outer.zip!2025-01-06.zip!hhd_RushCash.txt`."""

    data: bytes


def walk_sources(path: Path) -> Iterator[SourceFile]:
    """Yield every hand-text blob under `path`, descending into nested zips.

    Nested zips are the normal case, not an edge case: PokerCraft exports a zip per day and
    then a zip of those zips for a date range. Reading them in memory avoids writing 11GB of
    intermediate text to disk just to read it back once.
    """
    if path.is_dir():
        for child in sorted(path.rglob("*")):
            if child.is_file() and child.suffix.lower() in TEXT_SUFFIXES:
                yield SourceFile(str(child), child.read_bytes())
        return

    if path.suffix.lower() == ".zip":
        yield from _walk_zip(zipfile.ZipFile(path), str(path))
        return

    yield SourceFile(str(path), path.read_bytes())


def _walk_zip(archive: zipfile.ZipFile, prefix: str) -> Iterator[SourceFile]:
    """Recurse through one zip, yielding text members and descending into inner zips."""
    for info in sorted(archive.infolist(), key=lambda i: i.filename):
        if info.is_dir():
            continue
        name = info.filename
        lowered = name.lower()
        if lowered.endswith(".zip"):
            inner = zipfile.ZipFile(io.BytesIO(archive.read(info)))
            yield from _walk_zip(inner, f"{prefix}!{name}")
        elif lowered.endswith(TEXT_SUFFIXES):
            yield SourceFile(f"{prefix}!{name}", archive.read(info))


def already_done(dsn: str, user_uuid: str, digest: str) -> bool:
    """True when this exact content has already been imported for this user.

    Scoped by user, matching the `uq_uploads_user_sha256` constraint: two accounts importing
    the same public archive are two separate imports, not a duplicate.
    """
    with psycopg.connect(dsn, autocommit=True) as conn:
        row = conn.execute(
            "SELECT 1 FROM uploads WHERE user_id = %s AND sha256 = %s "
            "AND status = 'completed' LIMIT 1",
            (user_uuid, digest),
        ).fetchone()
    return row is not None


def record_upload(
    dsn: str,
    *,
    upload_id: str,
    user_uuid: str,
    site: str,
    label: str,
    key: str,
    digest: str,
    size: int,
    counts: dict[str, int],
) -> None:
    """Write the ledger row that makes a re-run skip this file."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO uploads (id, user_id, site, filename, object_key, sha256, "
            "byte_size, status, hands_found, hands_parsed, hands_failed, error_text, "
            "completed_at, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, 'completed', %s, %s, %s, '', "
            "now(), now(), now()) ON CONFLICT (user_id, sha256) DO UPDATE SET "
            "status = 'completed', hands_found = EXCLUDED.hands_found, "
            "hands_parsed = EXCLUDED.hands_parsed, hands_failed = EXCLUDED.hands_failed, "
            "completed_at = now(), updated_at = now()",
            (
                upload_id,
                user_uuid,
                site,
                label[-250:],
                key,
                digest,
                size,
                counts["found"],
                counts["parsed"],
                counts["failed"],
            ),
        )


@dataclass(slots=True, frozen=True)
class FileResult:
    """What one source file contributed. Typed so the progress counters stay integers."""

    label: str
    skipped: bool
    found: int
    parsed: int
    failed: int


@dataclass(slots=True)
class _WorkerContext:
    """Per-process state, built once in the pool initializer.

    A typed object rather than a dict of `object`: every field here is used in a position that
    needs its real type (a ClickHouse client, a parser, a frozenset of names), and a dict
    forces a cast at each use site — which is exactly where a wrong value would slip through.
    """

    client: Client
    parser: SiteParser
    site: str
    hero: frozenset[str]
    tenant_id: int
    dataset: str
    force: bool


_WORKER: _WorkerContext | None = None


def _init_worker(
    site: str, hero_names: list[str], tenant_id: int, dataset: str, force: bool
) -> None:
    """Per-process setup: one ClickHouse client and one parser, reused for every file.

    Building these per file would dominate the runtime of the small-file case and open one
    connection per source file in the large one.
    """
    global _WORKER
    _WORKER = _WorkerContext(
        client=clickhouse(),
        parser=get_parser(Site(site)),
        site=site,
        hero=frozenset(n.lower() for n in hero_names),
        tenant_id=tenant_id,
        dataset=dataset,
        force=force,
    )


def _ctx() -> _WorkerContext:
    """The initialized worker context. Raises rather than returning a half-built default."""
    if _WORKER is None:
        raise RuntimeError("worker pool initializer did not run")
    return _WORKER


def _process_one(job: tuple[str, bytes, str]) -> FileResult:
    """Store raw text, parse it, insert the hands. Runs in a worker process."""
    label, data, user_uuid = job
    settings = get_settings()
    ctx = _ctx()
    tenant_id, dataset, site = ctx.tenant_id, ctx.dataset, ctx.site

    digest = sha256_of(data)
    if not ctx.force and already_done(settings.postgres_libpq_dsn, user_uuid, digest):
        return FileResult(label, skipped=True, found=0, parsed=0, failed=0)

    upload_id = str(uuid.uuid4())
    key = object_key(
        tenant_id=tenant_id,
        site=site,
        digest=digest,
        filename=Path(label.split("!")[-1]).name,
    )
    # Raw text lands in object storage BEFORE parsing. If the parser crashes on this file, the
    # bytes are still durably stored and the import can be re-run after a fix (ADR-010).
    put_raw(key, data)

    text = decode_upload(data)
    result = ingest_text(
        ctx.client,
        ctx.parser,
        text,
        tenant_id=tenant_id,
        site=site,
        object_key=key,
        upload_id=upload_id,
        hero_names=ctx.hero,
        dataset=dataset,
        batch_size=settings.insert_batch_size,
    )
    record_failures(ctx.client, result.failures)
    counts = result.as_counts()
    record_upload(
        settings.postgres_libpq_dsn,
        upload_id=upload_id,
        user_uuid=user_uuid,
        site=site,
        label=label,
        key=key,
        digest=digest,
        size=len(data),
        counts=counts,
    )
    return FileResult(
        label,
        skipped=False,
        found=counts["found"],
        parsed=counts["parsed"],
        failed=counts["failed"],
    )


def resolve_user(dsn: str, email: str) -> tuple[str, int, list[str]]:
    """Look up the account to import into: (user uuid, tenant_id, registered screen names)."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        row = conn.execute("SELECT id, tenant_id FROM users WHERE email = %s", (email,)).fetchone()
        if row is None:
            raise SystemExit(f"no user with email {email!r} — run `make seed` or register first")
        user_uuid, tenant_id = str(row[0]), int(row[1])
        names = [
            r[0]
            for r in conn.execute(
                "SELECT screen_name FROM poker_accounts WHERE user_id = %s", (user_uuid,)
            ).fetchall()
        ]
    return user_uuid, tenant_id, names


def main(argv: list[str] | None = None) -> int:
    """Import every archive named on the command line."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--email", required=True, help="account to import into")
    ap.add_argument(
        "--dataset",
        choices=[DATASET_HERO, DATASET_POPULATION],
        default=DATASET_HERO,
        help="hero = hands you played; population = observed pool hands",
    )
    ap.add_argument("--site", default=Site.GGPOKER.value)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--limit", type=int, default=0, help="stop after N source files (testing)")
    ap.add_argument(
        "--force",
        action="store_true",
        help="re-import files the ledger already has — use after a parser fix, since "
        "ReplacingMergeTree supersedes the old rows rather than duplicating them",
    )
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    user_uuid, tenant_id, hero_names = resolve_user(settings.postgres_libpq_dsn, args.email)

    if args.dataset == DATASET_HERO and not hero_names:
        raise SystemExit(
            "no screen names registered for this account — hero hands would be unattributed.\n"
            "Register one first:  uv run python -m scripts.register_account "
            f"--email {args.email} --screen-name Hero"
        )
    log.info(
        "importing as %s (tenant %d), dataset=%s, hero names=%s, jobs=%d",
        args.email,
        tenant_id,
        args.dataset,
        hero_names or "(none — population import)",
        args.jobs,
    )

    started = time.monotonic()
    totals = {"files": 0, "skipped": 0, "found": 0, "parsed": 0, "failed": 0}

    def jobs() -> Iterator[tuple[str, bytes, str]]:
        seen = 0
        for path in args.paths:
            for source in walk_sources(path):
                if args.limit and seen >= args.limit:
                    return
                seen += 1
                yield (source.label, source.data, user_uuid)

    ctx = mp.get_context("spawn")
    with ctx.Pool(
        processes=args.jobs,
        initializer=_init_worker,
        initargs=(args.site, hero_names, tenant_id, args.dataset, args.force),
    ) as pool:
        for out in pool.imap_unordered(_process_one, jobs(), chunksize=1):
            totals["files"] += 1
            if out.skipped:
                totals["skipped"] += 1
            totals["found"] += out.found
            totals["parsed"] += out.parsed
            totals["failed"] += out.failed
            if totals["files"] % PROGRESS_EVERY == 0:
                elapsed = time.monotonic() - started
                rate = totals["parsed"] / elapsed if elapsed else 0
                log.info(
                    "[%4d files] parsed %9d  failed %6d  skipped %4d  %7.0f hands/s  %s",
                    totals["files"],
                    totals["parsed"],
                    totals["failed"],
                    totals["skipped"],
                    rate,
                    out.label[-58:],
                )

    elapsed = time.monotonic() - started
    log.info(
        "\ndone in %.1fs — %d files, %d stored, %d failed, %d skipped (already imported)",
        elapsed,
        totals["files"],
        totals["parsed"],
        totals["failed"],
        totals["skipped"],
    )
    if totals["found"]:
        log.info("validity: %.2f%%", 100 * totals["parsed"] / totals["found"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
