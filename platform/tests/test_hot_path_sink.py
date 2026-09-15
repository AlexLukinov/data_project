"""The ClickHouse sink derives each batch right after storing it, with the same stamp (ADR-047).

Against a recording client: what the sink sends, in what order, and with which parameters. The
generated statements run for real in `tests/integration/test_hot_path.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from clickhouse_connect.driver.summary import QuerySummary

from core.enums import Site
from core.models import CanonicalHand
from core.settings import get_settings
from ingestion.hot_path import TABLES, partitions_of
from ingestion.loader import batch_stamp
from ingestion.sinks.clickhouse import ClickHouseHandSink
from parser.registry import get_parser

HERO = frozenset({"hero"})


@dataclass
class RecordingClient:
    """Enough of clickhouse-connect's client to see what the sink does."""

    inserts: list[tuple[str, list[list[object]], list[str]]] = field(default_factory=list)
    commands: list[tuple[str, dict[str, Any], dict[str, Any]]] = field(default_factory=list)

    def insert(self, table: str, rows: list[list[object]], column_names: list[str]) -> None:
        self.inserts.append((table, rows, column_names))

    def command(
        self,
        sql: str,
        parameters: dict[str, Any] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> QuerySummary:
        self.commands.append((sql, dict(parameters or {}), dict(settings or {})))
        return QuerySummary({"written_rows": "3"})


@pytest.fixture
def hands(stars_cash_text: str) -> list[CanonicalHand]:
    parser = get_parser(Site.POKERSTARS)
    return [parser.parse_hand(chunk, HERO) for chunk in parser.split(stars_cash_text)]


def test_the_batch_is_derived_after_the_core_insert_with_the_same_stamp(
    hands: list[CanonicalHand],
) -> None:
    client = RecordingClient()
    sink = ClickHouseHandSink(client=client)  # type: ignore[arg-type]

    counts = sink.insert_hands(hands, tenant_id=7, dataset="hero")

    assert [t.rsplit(".", 1)[1] for t, _, _ in client.inserts] == [
        "hands",
        "hand_players",
        "actions",
        "pot_winners",
    ]
    marts = get_settings().db("marts")  # `test_marts` under `make test-all`
    assert [sql.split("\n")[5] for sql, _, _ in client.commands] == [
        f"INSERT INTO {marts}.{table}" for table in TABLES
    ]
    stamp_in_core = client.inserts[0][1][0][client.inserts[0][2].index("parsed_at")]
    for _, params, _ in client.commands:
        assert params["stamp"] == stamp_in_core, "the hot path must find the batch by its stamp"
        assert params["tenant"] == 7
        assert params["partitions"] == partitions_of(hands)
    settings = [given for _, _, given in client.commands]
    assert settings == [{"enable_analyzer": 0}, {}], (
        "the decisions statement plans with the legacy analyzer, player_hands with the default"
    )
    assert counts["decisions"] == 3 and counts["player_hands"] == 3


def test_hot_path_off_stores_the_core_tables_only(hands: list[CanonicalHand]) -> None:
    client = RecordingClient()
    sink = ClickHouseHandSink(client=client, hot_path=False)  # type: ignore[arg-type]
    counts = sink.insert_hands(hands, tenant_id=7, dataset="population")
    assert len(client.inserts) == 4 and client.commands == []
    assert "decisions" not in counts


def test_an_empty_batch_derives_nothing(hands: list[CanonicalHand]) -> None:
    client = RecordingClient()
    ClickHouseHandSink(client=client).insert_hands([], tenant_id=7, dataset="hero")  # type: ignore[arg-type]
    assert client.inserts == [] and client.commands == []


def test_the_stamp_is_the_millisecond_the_column_keeps() -> None:
    stamp = batch_stamp()
    assert stamp.tzinfo is UTC and stamp.microsecond % 1000 == 0
    assert abs((datetime.now(UTC) - stamp).total_seconds()) < 5


def test_partitions_are_the_days_the_hands_were_played(hands: list[CanonicalHand]) -> None:
    parts = partitions_of(hands)
    assert parts == sorted(set(parts))
    for hand in hands:
        assert int(hand.played_at_utc.astimezone(UTC).strftime("%Y%m%d")) in parts
