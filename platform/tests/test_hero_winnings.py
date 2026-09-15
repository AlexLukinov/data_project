"""The winnings curve: the rollup's per-day sums become running totals, and nothing divides by 0."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from typing import Any

from analysis.hero.winnings import winnings

COLUMNS = ["day", "hands", "won_bb", "ev_bb", "sd_bb", "nsd_bb"]


def _runner(rows: list[tuple[Any, ...]]) -> Any:
    def run(sql: str, params: Mapping[str, Any]) -> tuple[list[str], list[tuple[Any, ...]]]:
        return COLUMNS, rows

    return run


def test_a_range_with_no_hands_has_no_points_and_no_rate() -> None:
    result = winnings(7, date_from=date(2026, 9, 1), run=_runner([]))
    assert result.hands == 0 and result.points == []
    assert result.bb_per_100 is None and result.ev_bb_per_100 is None


def test_decimal_and_null_sums_accumulate_as_clickhouse_returns_them() -> None:
    rows = [
        (date(2026, 8, 18), 11, Decimal("-14.5"), Decimal("-14.5"), Decimal("-12.0"), None),
        (date(2026, 8, 19), 989, Decimal("0.3333"), None, Decimal("2.3333"), Decimal("-2.0")),
    ]
    result = winnings(7, run=_runner(rows))
    first, last = result.points
    assert first.cumulative_nonshowdown_bb == 0.0 and first.hands == 11
    assert (last.cumulative_net_bb, last.cumulative_ev_bb) == (-14.17, -14.5)
    assert (last.cumulative_showdown_bb, last.cumulative_nonshowdown_bb) == (-9.67, -2.0)
    assert last.hands == 989 and result.hands == 1000
    assert result.bb_per_100 == -1.42 and result.ev_bb_per_100 == -1.45
