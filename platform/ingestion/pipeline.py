"""The one parse -> validate -> store loop, shared by the Kafka worker and the bulk importer.

Both entry points must treat a hand identically: same validation gate, same dead-letter row,
same batch size, same idempotency. Two copies of this loop would drift the moment one of them
got a bug fix, and the symptom would be "stats differ depending on how the file was imported"
— which is close to undebuggable. (They did drift once: docs/POKER_AUDIT.md B2.)

The loop is a generator-driven stream, not a list build: a 47MB day-file holds ~35k hands, and
materializing all of them before inserting would cost hundreds of MB per worker for no gain.
Memory stays bounded by `batch_size` regardless of file size.

Everything it writes goes through a `HandSink` (ingestion/sinks), so the loop itself runs
against an in-memory fake in unit tests and against ClickHouse in production.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from core.allin import enrich
from core.models import CanonicalHand
from core.validation import validate
from ingestion.loader import DATASET_HERO
from ingestion.sinks.protocols import PARSE_FAILURE_COLUMNS, HandSink
from parser.base import SiteParser
from parser.errors import HandParseError, ParserError

log = logging.getLogger(__name__)

EXCERPT_CHARS = 2000
"""How much of a failed hand to keep in the dead-letter row. Enough to reproduce the bug --
which is the entire point of the dead-letter table."""

DEFAULT_BATCH_SIZE = 5_000
"""Rows per ClickHouse insert when the caller does not pass `settings.insert_batch_size`."""

FAILURE_ROW_WIDTH = len(PARSE_FAILURE_COLUMNS)
"""`_failure_row` builds rows in `PARSE_FAILURE_COLUMNS` order (defined at the sink seam)."""


@dataclass(slots=True)
class IngestResult:
    """Outcome of ingesting one source file."""

    found: int = 0
    stored: int = 0
    failed: int = 0
    without_hero: int = 0
    """Stored hands of a `hero` file in which no seat resolved as the uploader's. They are kept,
    and every hero stat filters `is_hero = 1`, so nothing would count them -- this is the only
    trace that a pool export went in under the wrong dataset (plan D.8, ADR-051)."""
    failures: list[list[object]] = field(default_factory=list)

    def as_counts(self) -> dict[str, int]:
        """The shape `uploads` rows and log lines expect."""
        return {
            "found": self.found,
            "parsed": self.stored,
            "failed": self.failed,
            "without_hero": self.without_hero,
        }


Progress = Callable[[IngestResult], None]
"""Told the running totals after every stored batch; the worker writes them to the upload row."""


@dataclass(slots=True, frozen=True)
class Source:
    """Provenance every stored hand and every dead letter carries."""

    tenant_id: int
    site: str
    object_key: str
    upload_id: str


def _failure_row(
    src: Source, offset: int, chunk: str, code: str, message: str, parser_version: int
) -> list[object]:
    """One `core.parse_failures` row, in `PARSE_FAILURE_COLUMNS` order."""
    row: list[object] = [
        src.tenant_id,
        src.upload_id,
        src.site,
        src.object_key,
        offset,
        chunk[:EXCERPT_CHARS],
        code,
        message,
        parser_version,
    ]
    if len(row) != FAILURE_ROW_WIDTH:  # pragma: no cover - guards the two definitions
        raise RuntimeError("dead-letter row does not match PARSE_FAILURE_COLUMNS")
    return row


def _outcome(
    parser: SiteParser, chunk: str, hero_names: frozenset[str], src: Source, offset: int
) -> CanonicalHand | list[object]:
    """Parse and validate one hand's text: the hand on success, a dead-letter row otherwise."""
    try:
        hand = parser.parse_hand(chunk, hero_names)
    except (HandParseError, ParserError) as exc:
        return _failure_row(src, offset, chunk, type(exc).__name__, str(exc), 1)
    check = validate(hand)
    if not check.ok:
        return _failure_row(
            src, offset, chunk, "validation_failed", check.summary(), hand.parser_version
        )
    hand.raw_object_key = src.object_key
    hand.raw_byte_offset = offset
    # After validation, never before: enrichment reads the reconciled pot, and a hand whose
    # money does not add up would produce an EV that does not either. A hand with no all-in
    # and no shown cards leaves this untouched, which is almost all of them.
    enrich(hand)
    return hand


def _file(
    result: IngestResult,
    batch: list[CanonicalHand],
    outcome: CanonicalHand | list[object],
    dataset: str,
) -> None:
    """Put one outcome where it belongs: a hand into the batch, anything else into the failures.

    A hand of a `hero` file with no hero seat is counted as it joins.
    """
    if isinstance(outcome, CanonicalHand):
        batch.append(outcome)
        result.without_hero += int(dataset == DATASET_HERO and outcome.hero_seat is None)
    else:
        result.failures.append(outcome)
        result.failed = len(result.failures)  # current for `progress`, not only at the end


def _flush(sink: HandSink, batch: list[CanonicalHand], tenant_id: int, dataset: str) -> int:
    """Insert the pending hands and empty the batch. Returns how many were stored."""
    if not batch:
        return 0
    sink.insert_hands(list(batch), tenant_id, dataset)
    stored = len(batch)
    batch.clear()
    return stored


def ingest_text(
    sink: HandSink,
    parser: SiteParser,
    raw_text: str,
    *,
    tenant_id: int,
    site: str,
    object_key: str,
    upload_id: str,
    hero_names: frozenset[str],
    dataset: str = DATASET_HERO,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress: Progress | None = None,
) -> IngestResult:
    """Parse every hand in `raw_text`, validate it, and store the survivors through `sink`.

    A hand whose money does not reconcile is NOT stored. Silently importing it would corrupt
    every stat it touches with no error anywhere — the worst failure mode an analytics product
    has. It goes to the dead-letter table instead, with enough raw text attached to reproduce.
    Dead letters are written by this function too, so no caller can forget them. `progress`,
    when given, is told the running totals after each batch reaches the sink.
    """
    src = Source(tenant_id=tenant_id, site=site, object_key=object_key, upload_id=upload_id)
    result = IngestResult()
    batch: list[CanonicalHand] = []
    offset = 0
    for chunk in parser.split(raw_text):
        result.found += 1
        _file(result, batch, _outcome(parser, chunk, hero_names, src, offset), dataset)
        offset += len(chunk)
        if len(batch) >= batch_size:
            result.stored += _flush(sink, batch, tenant_id, dataset)
            if progress is not None:
                progress(result)

    result.stored += _flush(sink, batch, tenant_id, dataset)
    result.failed = len(result.failures)
    sink.record_failures(result.failures)
    return result
