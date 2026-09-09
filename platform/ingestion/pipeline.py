"""The one parse -> validate -> store loop, shared by the Kafka worker and the bulk importer.

Both entry points must treat a hand identically: same validation gate, same dead-letter row,
same batch size, same idempotency. Two copies of this loop would drift the moment one of them
got a bug fix, and the symptom would be "stats differ depending on how the file was imported"
— which is close to undebuggable.

The loop is a generator-driven stream, not a list build: a 47MB day-file holds ~35k hands, and
materializing all of them before inserting would cost hundreds of MB per worker for no gain.
Memory stays bounded by `batch_size` regardless of file size.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from clickhouse_connect.driver.client import Client

from core.models import CanonicalHand
from core.validation import validate
from ingestion.loader import DATASET_HERO, insert_hands
from parser.base import SiteParser
from parser.errors import HandParseError, ParserError

log = logging.getLogger(__name__)

EXCERPT_CHARS = 2000
"""How much of a failed hand to keep in the dead-letter row. Enough to reproduce the bug --
which is the entire point of the dead-letter table."""

DEFAULT_BATCH_SIZE = 5_000
"""Rows per ClickHouse insert when the caller does not pass `settings.insert_batch_size`."""

PARSE_FAILURE_COLUMNS: tuple[str, ...] = (
    "user_id",
    "upload_id",
    "site",
    "raw_object_key",
    "raw_byte_offset",
    "hand_excerpt",
    "error_code",
    "error_message",
    "parser_version",
)
"""Column order of `core.parse_failures` rows, as built below and written by
`record_failures`. One definition, so the worker and the bulk importer cannot drift."""


def record_failures(client: Client, rows: list[list[object]]) -> None:
    """Write dead-letter rows.

    This table is a product backlog, not an error log: every row is a parser bug with a
    reproducible input attached. Review it weekly; it drives the parser roadmap better than
    guessing which network to support next.
    """
    if not rows:
        return
    client.insert("core.parse_failures", rows, column_names=list(PARSE_FAILURE_COLUMNS))


@dataclass(slots=True)
class IngestResult:
    """Outcome of ingesting one source file."""

    found: int = 0
    stored: int = 0
    failed: int = 0
    failures: list[list[object]] = field(default_factory=list)

    def as_counts(self) -> dict[str, int]:
        """The shape `uploads` rows and log lines expect."""
        return {"found": self.found, "parsed": self.stored, "failed": self.failed}


def ingest_text(
    client: Client,
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
) -> IngestResult:
    """Parse every hand in `raw_text`, validate it, and insert the survivors.

    A hand whose money does not reconcile is NOT stored. Silently importing it would corrupt
    every stat it touches with no error anywhere — the worst failure mode an analytics product
    has. It goes to `core.parse_failures` instead, with enough raw text attached to reproduce.
    """
    result = IngestResult()
    batch: list[CanonicalHand] = []
    offset = 0

    def flush() -> None:
        nonlocal batch
        if batch:
            insert_hands(client, batch, tenant_id, dataset)
            result.stored += len(batch)
            batch = []

    for chunk in parser.split(raw_text):
        result.found += 1
        chunk_offset = offset
        offset += len(chunk)

        try:
            hand = parser.parse_hand(chunk, hero_names)
        except (HandParseError, ParserError) as exc:
            result.failures.append(
                [
                    tenant_id,
                    upload_id,
                    site,
                    object_key,
                    chunk_offset,
                    chunk[:EXCERPT_CHARS],
                    type(exc).__name__,
                    str(exc),
                    1,
                ]
            )
            continue

        check = validate(hand)
        if not check.ok:
            result.failures.append(
                [
                    tenant_id,
                    upload_id,
                    site,
                    object_key,
                    chunk_offset,
                    chunk[:EXCERPT_CHARS],
                    "validation_failed",
                    check.summary(),
                    hand.parser_version,
                ]
            )
            continue

        hand.raw_object_key = object_key
        hand.raw_byte_offset = chunk_offset
        batch.append(hand)
        if len(batch) >= batch_size:
            flush()

    flush()
    result.failed = len(result.failures)
    return result
