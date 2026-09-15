"""The Kafka worker runs the SAME ingest loop as the bulk importer, against fake sinks.

Regression for docs/POKER_AUDIT.md B2: the worker once carried its own copy of the
parse -> validate -> store loop, which silently stored every upload as `dataset='hero'`.
These tests drive `worker.process` end to end with no stack, through the `HandSink` and
`RawStore` fakes from `ingestion.sinks`.
"""

from __future__ import annotations

import pytest

from ingestion import worker
from ingestion.loader import DATASET_POPULATION
from ingestion.messages import UploadMessage
from ingestion.sinks import FakeHandSink, FakeRawStore

KEY = "site=pokerstars/user_id=00000007/x.txt.zst"


def _message(dataset: str) -> UploadMessage:
    return UploadMessage(
        upload_id="upload-1",
        tenant_id=7,
        site="pokerstars",
        object_key=KEY,
        sha256="",
        hero_names=["Hero"],
        dataset=dataset,
    )


@pytest.fixture
def store(stars_cash_text: str) -> FakeRawStore:
    return FakeRawStore({KEY: stars_cash_text})


def test_worker_stores_hands_under_the_message_dataset(store: FakeRawStore) -> None:
    """The dataset comes from the message, never from a default buried in the worker."""
    sink = FakeHandSink()

    counts = worker.process(_message(DATASET_POPULATION), sink=sink, store=store)

    assert counts == {"found": 2, "parsed": 2, "failed": 0, "without_hero": 0}
    assert len(sink.hands) == 2
    assert {dataset for _, _, dataset in sink.inserts} == {DATASET_POPULATION}
    assert {tenant for _, tenant, _ in sink.inserts} == {7}


def test_worker_resolves_hero_and_provenance(store: FakeRawStore) -> None:
    sink = FakeHandSink()
    worker.process(_message("hero"), sink=sink, store=store)
    for hand in sink.hands:
        assert hand.hero is not None and hand.hero.is_hero
        assert hand.raw_object_key == KEY
    assert sink.failures == []


def test_worker_dead_letters_a_hand_that_does_not_parse(
    store: FakeRawStore, stars_cash_text: str
) -> None:
    """An unparseable hand is recorded, not dropped, and the good hand still lands."""
    store.objects[KEY] = stars_cash_text.replace("*** SUMMARY ***", "*** GARBAGE ***", 1)
    sink = FakeHandSink()

    counts = worker.process(_message("hero"), sink=sink, store=store)

    assert counts["found"] == 2
    assert counts["failed"] + counts["parsed"] == 2
    assert len(sink.failures) == counts["failed"]
    for row in sink.failures:
        assert row[1] == "upload-1" and row[3] == KEY
