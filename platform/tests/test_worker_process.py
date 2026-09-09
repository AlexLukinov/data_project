"""The Kafka worker runs the SAME ingest loop as the bulk importer, against a fake sink.

Regression for docs/POKER_AUDIT.md B2: the worker once carried its own copy of the
parse -> validate -> store loop, which silently stored every upload as `dataset='hero'`.
These tests drive `worker.process` end to end with no stack, asserting on the rows that reach
the ClickHouse client.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from ingestion import worker
from ingestion.bus import UploadMessage
from ingestion.loader import DATASET_POPULATION, HANDS_COLUMNS


@dataclass
class _FakeClient:
    """Records every insert the way `clickhouse_connect`'s client would receive it."""

    inserts: list[tuple[str, list[list[object]], list[str]]] = field(default_factory=list)

    def insert(
        self, table: str, rows: list[list[object]], column_names: list[str]
    ) -> None:  # pragma: no cover - trivial recorder
        self.inserts.append((table, rows, column_names))

    def rows_for(self, table: str) -> list[list[object]]:
        return [row for t, rows, _ in self.inserts if t == table for row in rows]


def _message(dataset: str) -> UploadMessage:
    return UploadMessage(
        upload_id="upload-1",
        tenant_id=7,
        site="pokerstars",
        object_key="site=pokerstars/user_id=00000007/x.txt.zst",
        sha256="",
        hero_names=["Hero"],
        dataset=dataset,
    )


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch, stars_cash_text: str) -> _FakeClient:
    client = _FakeClient()
    monkeypatch.setattr(worker, "clickhouse", lambda: client)
    monkeypatch.setattr(worker, "get_raw", lambda _key: stars_cash_text)
    return client


def test_worker_stores_hands_under_the_message_dataset(fake_client: _FakeClient) -> None:
    """The dataset comes from the message, never from a default buried in the worker."""
    counts = worker.process(_message(DATASET_POPULATION))

    assert counts == {"found": 2, "parsed": 2, "failed": 0}
    hands = fake_client.rows_for("core.hands")
    assert len(hands) == 2
    dataset_at = HANDS_COLUMNS.index("dataset")
    assert {row[dataset_at] for row in hands} == {DATASET_POPULATION}


def test_worker_writes_every_core_table_and_no_dead_letters(fake_client: _FakeClient) -> None:
    worker.process(_message("hero"))
    tables = {table for table, _, _ in fake_client.inserts}
    assert tables == {"core.hands", "core.hand_players", "core.actions", "core.pot_winners"}


def test_worker_dead_letters_a_hand_that_does_not_parse(
    monkeypatch: pytest.MonkeyPatch, fake_client: _FakeClient, stars_cash_text: str
) -> None:
    """An unparseable hand is recorded, not dropped, and the good hand still lands."""
    broken = stars_cash_text.replace("*** SUMMARY ***", "*** GARBAGE ***", 1)
    monkeypatch.setattr(worker, "get_raw", lambda _key: broken)

    counts = worker.process(_message("hero"))

    assert counts["found"] == 2
    assert counts["failed"] + counts["parsed"] == 2
    failures = fake_client.rows_for("core.parse_failures")
    assert len(failures) == counts["failed"]
    if failures:
        _, _, columns = next(i for i in fake_client.inserts if i[0] == "core.parse_failures")
        assert failures[0][columns.index("upload_id")] == "upload-1"
