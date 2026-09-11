"""Re-parsing a stored corpus (plan §5b): what the loop must not get wrong.

The script's real check is that it reproduces the database it read — verified on the corpus
itself, where the 60 smallest pool objects hold exactly 14,807 hands and the re-parse stored
exactly 14,807. What is worth pinning here is the handling either side of that: provenance
comes from the rows, never from a flag, and an object whose bytes cannot be fetched is counted
rather than ending the run or being passed over in silence.
"""

from __future__ import annotations

from typing import Any

import pytest

from ingestion.pipeline import IngestResult
from scripts import reparse
from scripts.reparse import SourceObject, Totals

OBJECT = SourceObject(
    key="site=ggpoker/user_id=00000001/x.txt.zst", user_id=7, site="ggpoker", hands=3
)


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture what `ingest_text` was asked to do, with nothing behind it."""
    seen: list[dict[str, Any]] = []

    def fake_ingest(sink: Any, parser: Any, text: str, **kwargs: Any) -> IngestResult:
        seen.append({"text": text, **kwargs})
        return IngestResult(found=3, stored=2, failed=1)

    monkeypatch.setattr(reparse, "ingest_text", fake_ingest)
    monkeypatch.setattr(reparse.sinks, "hand_sink", lambda: object())
    monkeypatch.setattr(reparse, "get_parser", lambda site: object())
    return seen


def test_a_hand_keeps_the_tenant_dataset_and_object_it_already_had(
    calls: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Re-parsing must not relabel anything: a corpus can hold more than one tenant or site."""
    monkeypatch.setattr(reparse, "get_raw", lambda key: "PokerStars Hand #1")
    totals = Totals()
    reparse.reparse_one(OBJECT, "population", totals)

    assert len(calls) == 1
    assert calls[0]["tenant_id"] == 7
    assert calls[0]["site"] == "ggpoker"
    assert calls[0]["object_key"] == OBJECT.key
    assert calls[0]["dataset"] == "population"
    # No hero seat is inferred, so no row can be promoted to hero by a re-parse.
    assert calls[0]["hero_names"] == frozenset()
    assert (totals.objects, totals.found, totals.stored, totals.failed) == (1, 3, 2, 1)


def test_an_object_that_cannot_be_read_is_counted_not_fatal(
    calls: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """One unreadable object must not end a run of 2,492, nor pass unnoticed."""

    def gone(key: str) -> str:
        raise OSError("no such key")

    monkeypatch.setattr(reparse, "get_raw", gone)
    totals = Totals()
    reparse.reparse_one(OBJECT, "population", totals)

    assert totals.missing == 1
    assert totals.objects == 0 and totals.stored == 0
    assert calls == []


def test_a_partial_run_exits_non_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    """The exit code is what a shell loop or a cron would notice."""
    monkeypatch.setattr(reparse, "reparse", lambda dataset, limit: Totals(objects=2, missing=1))
    assert reparse.main(["--dataset", "population"]) == 1

    monkeypatch.setattr(reparse, "reparse", lambda dataset, limit: Totals(objects=2))
    assert reparse.main(["--dataset", "population"]) == 0
