"""Re-parse a corpus already in the database, from the raw text it was stored with.

**Why this exists.** The raw text is kept forever in object storage (ADR-010), precisely so a
parser fix can be applied to hands that were imported before it. Plan §5b is the case it was
kept for: observed GGPoker tables print a seat's revealed cards only in the per-seat SUMMARY,
which the parser skipped, so 82.6% of the pool's showdown seats were stored without cards.
The fix shipped with F.8; nothing in the database changes until the corpus is read again.

**Why it is safe to re-run.** `hand_uid` is content-addressed and every `core` table is a
ReplacingMergeTree keyed on it, so re-ingesting the same text **replaces** rows rather than
adding them. The loop is `ingestion.pipeline.ingest_text` — the same one the worker and the
bulk importer use — so a re-parsed hand goes through exactly the validation, dead-lettering and
batching a freshly uploaded one does. Nothing is written to object storage: the bytes are
already there and are the input, not the output.

It walks objects, not hands, and holds one object at a time, so memory is bounded by the
largest source file no matter how big the corpus is. Interrupting it is safe: every object is
independent and an object done twice converges to the same rows.

**It walks the objects that stored hands point at — deliberately, not by oversight.** An object
key can also appear in `core.parse_failures` and nowhere else, which looks at first like a file
the corpus lost; on 2026-09-11 there were 3,055 of them holding 85,326 dead letters. They are
not a gap. Object keys are content-addressed, so re-importing the same file after a parser fix
writes a *new* key, and the hands settle under it — the old key survives only in the dead
letters of the import it superseded. Every sampled hand from one of those files was already in
`core.hands` under its 2026-09-09 sibling. Re-parsing them would store nothing new and would
rewrite `raw_object_key` on hands that already have the current one, so the query starts from
`core.hands` on purpose. A genuinely lost file would show up as raw text with no stored hand
*and* no sibling key holding the same hands.

    uv run python -m scripts.reparse --dataset population          # the whole pool corpus
    uv run python -m scripts.reparse --dataset population --limit 5   # a slice, to check first

Afterwards the marts must be rebuilt for the touched days: `uv run python -m scripts.backfill`
(ADR-019 — never a one-shot `dbt build --full-refresh`).
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
import uuid
from dataclasses import dataclass

from core.enums import Site
from core.settings import get_settings
from ingestion import sinks
from ingestion.clickhouse import clickhouse
from ingestion.loader import DATASET_HERO, DATASET_POPULATION
from ingestion.pipeline import ingest_text
from ingestion.storage import get_raw
from parser.registry import get_parser

log = logging.getLogger("reparse")

PROGRESS_EVERY = 25
"""Objects between progress lines. A pool object is ~3,600 hands, so this is a line a minute."""


@dataclass(slots=True, frozen=True)
class SourceObject:
    """One stored file, and the provenance the hands from it must keep."""

    key: str
    user_id: int
    site: str
    hands: int


@dataclass(slots=True)
class Totals:
    """What the run did, for the closing line and the exit code."""

    objects: int = 0
    found: int = 0
    stored: int = 0
    failed: int = 0
    missing: int = 0
    """Objects whose raw text could not be fetched — counted, never silently skipped."""


def sources(dataset: str, limit: int | None = None) -> list[SourceObject]:
    """Every object the dataset's hands came from, largest last so progress is steady.

    `site` and `user_id` come from the rows themselves rather than from a flag: a corpus can
    hold more than one of either, and re-parsing must not relabel anything.
    """
    settings = get_settings()
    rows = (
        clickhouse()
        .query(
            # The only interpolation is the settings' own database name; every value binds.
            f"SELECT raw_object_key, user_id, site, count() AS hands "
            f"FROM {settings.db('core')}.hands "
            "WHERE dataset = {dataset:String} AND raw_object_key != '' "
            "GROUP BY raw_object_key, user_id, site ORDER BY hands ASC"
            + (" LIMIT {limit:UInt32}" if limit else ""),
            parameters={"dataset": dataset, "limit": limit or 0},
        )
        .result_rows
    )
    return [SourceObject(key=k, user_id=int(u), site=str(s), hands=int(n)) for k, u, s, n in rows]


def reparse_one(source: SourceObject, dataset: str, totals: Totals) -> None:
    """Read one object's text and push it back through the ingest loop."""
    try:
        text = get_raw(source.key)
    except Exception:
        log.exception("could not fetch %s (%d hands) — left as it is", source.key, source.hands)
        totals.missing += 1
        return
    result = ingest_text(
        sinks.hand_sink(),
        get_parser(Site(source.site)),
        text,
        tenant_id=source.user_id,
        site=source.site,
        object_key=source.key,
        upload_id=str(uuid.uuid4()),
        # A pool export has no hero seat, and a hero export's own name is already on its rows;
        # `is_hero` is not recomputed here, so nothing can be relabelled by a re-parse.
        hero_names=frozenset(),
        dataset=dataset,
        batch_size=get_settings().insert_batch_size,
    )
    totals.objects += 1
    totals.found += result.found
    totals.stored += result.stored
    totals.failed += result.failed


def reparse(dataset: str, limit: int | None = None) -> Totals:
    """Re-parse every object of a dataset. Returns what it did."""
    found = sources(dataset, limit)
    log.info(
        "re-parsing %d objects (%d hands) of dataset %s",
        len(found),
        sum(s.hands for s in found),
        dataset,
    )
    totals = Totals()
    started = time.monotonic()
    for i, source in enumerate(found, 1):
        reparse_one(source, dataset, totals)
        if i % PROGRESS_EVERY == 0 or i == len(found):
            rate = totals.stored / max(time.monotonic() - started, 1e-9)
            log.info(
                "%d/%d objects · %d hands stored · %d failed · %.0f hands/s",
                i,
                len(found),
                totals.stored,
                totals.failed,
                rate,
            )
    return totals


def main(argv: list[str] | None = None) -> int:
    """Entry point. Non-zero when an object could not be read, so a partial run is visible."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset", choices=[DATASET_HERO, DATASET_POPULATION], required=True)
    ap.add_argument("--limit", type=int, default=None, help="only the N smallest objects")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    totals = reparse(args.dataset, args.limit)
    log.info(
        "done: %d objects · %d hands found · %d stored · %d failed · %d objects unreadable",
        totals.objects,
        totals.found,
        totals.stored,
        totals.failed,
        totals.missing,
    )
    log.info("now rebuild the marts: uv run python -m scripts.backfill")
    return 1 if totals.missing else 0


if __name__ == "__main__":
    sys.exit(main())
