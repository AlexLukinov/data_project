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
import logging
import multiprocessing as mp
import os
import sys
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from core.enums import Site
from core.settings import get_settings
from ingestion import sinks
from ingestion.archive import walk_sources
from ingestion.ledger import already_done, record_upload, resolve_user
from ingestion.loader import DATASET_HERO, DATASET_POPULATION
from ingestion.pipeline import ingest_text
from ingestion.sinks.protocols import HandSink, RawStore
from ingestion.storage import decode_upload, object_key, sha256_of
from parser.base import SiteParser
from parser.registry import get_parser

log = logging.getLogger("import")

PROGRESS_EVERY = 1
LABEL_TAIL = 58
"""Characters of the source label shown on a progress line."""

Job = tuple[str, bytes, str]
"""(label, raw bytes, user uuid) — what a pool worker receives."""


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
    needs its real type (a hand sink, a parser, a frozenset of names), and a dict forces a
    cast at each use site — which is exactly where a wrong value would slip through.
    """

    sink: HandSink
    store: RawStore
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
    """Per-process setup: one hand sink, one raw store and one parser, reused for every file.

    Building these per file would dominate the runtime of the small-file case and open one
    connection per source file in the large one.
    """
    global _WORKER
    _WORKER = _WorkerContext(
        # Core tables only: an archive is followed by `scripts.backfill`, which derives every
        # partition anyway, and the per-batch hot path would run ~1,800 times for a 9M-hand
        # pool import for nothing (ADR-047).
        sink=sinks.hand_sink(hot_path=False),
        store=sinks.raw_store(),
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


def _process_one(job: Job) -> FileResult:
    """Store raw text, parse it, insert the hands, record the ledger row. Runs in a worker."""
    label, data, user_uuid = job
    settings = get_settings()
    ctx = _ctx()
    digest = sha256_of(data)
    if not ctx.force and already_done(settings.postgres_libpq_dsn, user_uuid, digest):
        return FileResult(label, skipped=True, found=0, parsed=0, failed=0)

    upload_id = str(uuid.uuid4())
    key = object_key(
        tenant_id=ctx.tenant_id,
        site=ctx.site,
        digest=digest,
        filename=Path(label.split("!")[-1]).name,
    )
    counts = _store_and_ingest(ctx, data, key=key, upload_id=upload_id)
    record_upload(
        settings.postgres_libpq_dsn,
        upload_id=upload_id,
        user_uuid=user_uuid,
        site=ctx.site,
        label=label,
        key=key,
        digest=digest,
        size=len(data),
        counts=counts,
        dataset=ctx.dataset,
    )
    return FileResult(label, False, counts["found"], counts["parsed"], counts["failed"])


def _store_and_ingest(
    ctx: _WorkerContext, data: bytes, *, key: str, upload_id: str
) -> dict[str, int]:
    """Raw text to object storage FIRST, then the shared parse -> validate -> store loop.

    If the parser crashes on this file, the bytes are still durably stored and the import can
    be re-run after a fix (ADR-010).
    """
    ctx.store.put(key, data)
    result = ingest_text(
        ctx.sink,
        ctx.parser,
        decode_upload(data),
        tenant_id=ctx.tenant_id,
        site=ctx.site,
        object_key=key,
        upload_id=upload_id,
        hero_names=ctx.hero,
        dataset=ctx.dataset,
        batch_size=get_settings().insert_batch_size,
    )
    return result.as_counts()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
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
    return ap.parse_args(argv)


def _jobs(paths: list[Path], user_uuid: str, limit: int) -> Iterator[Job]:
    seen = 0
    for path in paths:
        for source in walk_sources(path):
            if limit and seen >= limit:
                return
            seen += 1
            yield (source.label, source.data, user_uuid)


def _run_pool(
    args: argparse.Namespace, jobs: Iterator[Job], initargs: tuple[object, ...]
) -> dict[str, int]:
    """Drive the process pool and keep the running totals, logging progress as files finish."""
    started = time.monotonic()
    totals = {"files": 0, "skipped": 0, "found": 0, "parsed": 0, "failed": 0}
    with mp.get_context("spawn").Pool(
        processes=args.jobs, initializer=_init_worker, initargs=initargs
    ) as pool:
        for out in pool.imap_unordered(_process_one, jobs, chunksize=1):
            totals["files"] += 1
            totals["skipped"] += int(out.skipped)
            totals["found"] += out.found
            totals["parsed"] += out.parsed
            totals["failed"] += out.failed
            if totals["files"] % PROGRESS_EVERY == 0:
                elapsed = time.monotonic() - started
                log.info(
                    "[%4d files] parsed %9d  failed %6d  skipped %4d  %7.0f hands/s  %s",
                    totals["files"],
                    totals["parsed"],
                    totals["failed"],
                    totals["skipped"],
                    totals["parsed"] / elapsed if elapsed else 0,
                    out.label[-LABEL_TAIL:],
                )
    totals["seconds"] = int(time.monotonic() - started)
    return totals


def main(argv: list[str] | None = None) -> int:
    """Import every archive named on the command line."""
    args = _parse_args(argv)
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
    totals = _run_pool(
        args,
        _jobs(args.paths, user_uuid, args.limit),
        (args.site, hero_names, tenant_id, args.dataset, args.force),
    )
    log.info(
        "\ndone in %ds — %d files, %d stored, %d failed, %d skipped (already imported)",
        totals["seconds"],
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
