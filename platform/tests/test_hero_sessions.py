"""Sessions: the query is scoped like a report, and the rows become sittings with rates."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from analysis.hero.sessions import sessions, sessions_query


def test_sessions_query_is_scoped_to_the_hero_and_bound() -> None:
    sql, params = sessions_query(7, gap_minutes=45, date_from=date(2026, 8, 1), date_to=None)
    assert "marts.player_hands AS s WHERE s.user_id = {tenant_id:UInt32}" in sql
    assert "s.dataset = {dataset:String}" in sql and "s.is_hero = 1" in sql
    assert "s.played_date >= {date_from:Date}" in sql and "{date_to:Date}" not in sql
    assert "lagInFrame(played_at_utc) OVER (ORDER BY played_at_utc, hand_uid)" in sql
    assert "> {gap_seconds:UInt32}" in sql and sql.endswith(
        "GROUP BY session_no ORDER BY started_at"
    )
    assert params == {
        "tenant_id": 7,
        "dataset": "hero",
        "date_from": date(2026, 8, 1),
        "gap_seconds": 2700,
    }


def test_rows_become_sessions_with_durations_and_rates() -> None:
    rows = [
        (
            1,
            datetime(2026, 8, 20, 18, 0, tzinfo=UTC),
            datetime(2026, 8, 20, 20, 30, tzinfo=UTC),
            400,
            Decimal("52.5000"),
            Decimal("40.2500"),
            ["pokerstars"],
            ["NL50"],
        ),
        (
            2,
            datetime(2026, 8, 21, 9, 0, tzinfo=UTC),
            datetime(2026, 8, 21, 9, 20, tzinfo=UTC),
            50,
            Decimal("-10.0000"),
            Decimal("-8.0000"),
            ["pokerstars", "ggpoker"],
            ["NL50", "NL25"],
        ),
    ]
    columns = [
        "session_no", "started_at", "ended_at", "hand_count", "net_total", "ev_total",
        "site_list", "stake_list",
    ]  # fmt: skip

    def run(sql: str, params: Mapping[str, Any]) -> tuple[list[str], list[tuple[Any, ...]]]:
        return columns, rows

    result = sessions(7, run=run)
    assert result.gap_minutes == 30 and result.hands == 450 and result.net_bb == 42.5
    first, second = result.sessions
    assert first.minutes == 150 and first.hands == 400 and first.bb_per_100 == 13.12
    assert first.ev_bb == 40.25 and first.sites == ["pokerstars"] and first.stakes == ["NL50"]
    assert second.minutes == 20 and second.bb_per_100 == -20.0 and second.stakes == ["NL50", "NL25"]


def test_no_hands_is_no_sessions() -> None:
    def run(sql: str, params: Mapping[str, Any]) -> tuple[list[str], list[tuple[Any, ...]]]:
        return ["session_no"], []

    result = sessions(7, run=run)
    assert result.sessions == [] and result.hands == 0 and result.net_bb == 0.0
