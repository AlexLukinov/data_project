"""Row-shaping guarantees for `ingestion.loader.to_rows`.

These are cheap tests guarding two mistakes that produce *plausible, wrong* data rather than an
error — the failure mode that costs the most, because nothing downstream complains.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from core.enums import Site
from ingestion.loader import (
    ACTIONS_COLUMNS,
    HANDS_COLUMNS,
    PLAYERS_COLUMNS,
    WINNERS_COLUMNS,
    to_rows,
)
from parser.registry import parse_file

TENANT = 1


@pytest.fixture(scope="module")
def gg_hands(gg_text: str) -> list:
    """Parsed GGPoker corpus hands, the same fixture the parser tests use."""
    return list(parse_file(gg_text, Site.GGPOKER))


def test_every_row_matches_its_column_list(gg_hands: list) -> None:
    """A row shorter or longer than its column list silently misaligns every column."""
    hands, players, actions, winners = to_rows(gg_hands, TENANT)
    for rows, columns, name in (
        (hands, HANDS_COLUMNS, "hands"),
        (players, PLAYERS_COLUMNS, "hand_players"),
        (actions, ACTIONS_COLUMNS, "actions"),
        (winners, WINNERS_COLUMNS, "pot_winners"),
    ):
        assert rows, f"{name}: corpus produced no rows"
        for row in rows:
            assert len(row) == len(columns), f"{name}: row width != column count"


def test_timestamps_stay_timezone_aware(gg_hands: list) -> None:
    """**Regression: naive datetimes are silently shifted by the host's UTC offset.**

    clickhouse-connect interprets a naive datetime as *local* time and converts it to UTC. A
    `.replace(tzinfo=None)` on the way into the driver therefore moved every hand in the
    database by the importing machine's offset — three hours, on the machine this was found on
    — and made the stored data depend on which host ran the import. Nothing raises: the values
    look like perfectly ordinary timestamps.
    """
    stamp = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    hands, players, actions, winners = to_rows(gg_hands, TENANT, parsed_at=stamp)

    for rows, columns, name in (
        (hands, HANDS_COLUMNS, "hands"),
        (players, PLAYERS_COLUMNS, "hand_players"),
        (actions, ACTIONS_COLUMNS, "actions"),
        (winners, WINNERS_COLUMNS, "pot_winners"),
    ):
        played = columns.index("played_at_utc")
        parsed = columns.index("parsed_at")
        for row in rows:
            assert row[played].tzinfo is not None, f"{name}: played_at_utc lost its tzinfo"
            assert row[played].utcoffset().total_seconds() == 0, f"{name}: not UTC"
            assert row[parsed] == stamp, f"{name}: parsed_at was not the batch stamp"


def test_parsed_at_is_identical_across_all_four_tables(gg_hands: list) -> None:
    """One hand, one ingest timestamp.

    `parsed_at` is both the ReplacingMergeTree version column and the watermark the incremental
    dbt models read. Letting the column DEFAULT fire per-INSERT gave the four tables four
    timestamps milliseconds apart, so a re-parse could collapse them inconsistently and the
    models could disagree about which partitions are dirty.
    """
    hands, players, actions, winners = to_rows(gg_hands, TENANT)
    stamps = {
        row[columns.index("parsed_at")]
        for rows, columns in (
            (hands, HANDS_COLUMNS),
            (players, PLAYERS_COLUMNS),
            (actions, ACTIONS_COLUMNS),
            (winners, WINNERS_COLUMNS),
        )
        for row in rows
    }
    assert len(stamps) == 1, f"expected one batch stamp, got {len(stamps)}"
