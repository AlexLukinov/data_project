"""`ingest_text`, the one ingest loop, against the in-memory sink.

The loop decides what is stored and what is dead-lettered; it had zero unit coverage until
2026-09-09 (docs/POKER_AUDIT.md §9). These tests need no stack.
"""

from __future__ import annotations

from collections.abc import Iterator

from core.enums import Site
from core.models import CanonicalHand
from ingestion.pipeline import ingest_text
from ingestion.sinks import FakeHandSink
from ingestion.sinks.protocols import PARSE_FAILURE_COLUMNS
from parser.base import SiteParser
from parser.errors import HandParseError
from parser.registry import get_parser

HERO = frozenset({"hero"})


class _FailingParser:
    """Splits on blank lines and refuses every chunk -- the pure dead-letter path."""

    site = Site.POKERSTARS

    def matches(self, text: str) -> bool:
        return True

    def split(self, text: str) -> Iterator[str]:
        yield from (c for c in text.split("\n\n") if c.strip())

    def parse_hand(self, raw_text: str, hero_names: frozenset[str] | None = None) -> CanonicalHand:
        raise HandParseError("boom")


def _run(
    text: str, sink: FakeHandSink, parser: SiteParser | None = None, **kwargs: object
) -> dict[str, int]:
    result = ingest_text(
        sink,
        parser or get_parser(Site.POKERSTARS),
        text,
        tenant_id=3,
        site="pokerstars",
        object_key="k",
        upload_id="u",
        hero_names=HERO,
        **kwargs,  # type: ignore[arg-type]
    )
    return result.as_counts()


def test_every_valid_hand_is_stored_with_its_offset(stars_cash_text: str) -> None:
    sink = FakeHandSink()
    counts = _run(stars_cash_text, sink)
    assert counts == {"found": 2, "parsed": 2, "failed": 0}
    offsets = [h.raw_byte_offset for h in sink.hands]
    assert offsets[0] == 0 and offsets[1] > 0, "each hand points back into the raw text"
    assert all(h.raw_object_key == "k" for h in sink.hands)


def test_batches_flush_at_batch_size(stars_edge_text: str) -> None:
    """Memory stays bounded by batch_size: four hands at batch_size=1 are four inserts."""
    sink = FakeHandSink()
    counts = _run(stars_edge_text, sink, batch_size=1)
    assert counts["parsed"] == 4
    assert len(sink.inserts) == 4


def test_dataset_reaches_the_sink(stars_cash_text: str) -> None:
    sink = FakeHandSink()
    _run(stars_cash_text, sink, dataset="population")
    assert {d for _, _, d in sink.inserts} == {"population"}


def test_unbalanced_hand_is_dead_lettered_not_stored(stars_cash_text: str) -> None:
    """A hand whose money does not reconcile must never reach the tables."""
    broken = stars_cash_text.replace("collected $", "collected $9", 1)
    sink = FakeHandSink()
    counts = _run(broken, sink)
    assert counts["found"] == 2
    assert counts["failed"] == 1 and counts["parsed"] == 1
    (row,) = sink.failures
    assert len(row) == len(PARSE_FAILURE_COLUMNS)
    assert row[PARSE_FAILURE_COLUMNS.index("error_code")] == "validation_failed"
    assert row[PARSE_FAILURE_COLUMNS.index("upload_id")] == "u"


def test_dead_letters_are_written_even_when_nothing_parses() -> None:
    """The loop writes its own dead letters; a caller cannot forget them."""
    sink = FakeHandSink()
    counts = _run("chunk one\n\nchunk two\n\nchunk three", sink, parser=_FailingParser())
    assert counts == {"found": 3, "parsed": 0, "failed": 3}
    assert len(sink.failures) == 3
    assert {row[PARSE_FAILURE_COLUMNS.index("error_code")] for row in sink.failures} == {
        "HandParseError"
    }
    assert sink.failures[1][PARSE_FAILURE_COLUMNS.index("raw_byte_offset")] == len("chunk one")
