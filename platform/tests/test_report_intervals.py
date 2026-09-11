"""Where a confidence interval costs a column, and where it costs the rollup (plan E.2).

The arithmetic itself is `tests/test_intervals.py`. This is the wiring: which SQL the request
produces once a level is asked for, and which table answers it. Like the rest of the query
tests, these need no stack -- they assert on what the builder produces.
"""

from __future__ import annotations

from typing import Any

from stats.query import build_query
from stats.registry import registry
from stats.request import ReportRequest
from stats.resolve import dimensions_used, resolve_stats
from stats.router import plan


def _build(request: ReportRequest) -> list[str]:
    """Plan and build exactly as `stats.service.run_report` does, including the interval flag."""
    reg = registry()
    stats = resolve_stats(request, reg)
    plans = plan(stats, dimensions_used(request), reg, dispersion=request.confidence is not None)
    built: list[tuple[str, dict[str, Any]]] = [build_query(request, 1, p, reg) for p in plans]
    return [sql for sql, _ in built]


def _one(request: ReportRequest) -> str:
    queries = _build(request)
    assert len(queries) == 1
    return queries[0]


def test_a_confidence_level_asks_for_the_spread_of_a_per_hundred_stat() -> None:
    sql = _one(ReportRequest(stats=["bb_per_100"], confidence=95))
    assert "round(100 * sum(s.net_won_bb) / nullIf(count(), 0), 3) AS bb_per_100" in sql
    assert "count() AS bb_per_100__n" in sql
    assert "stddevSamp(s.net_won_bb) AS bb_per_100__sd" in sql


def test_the_spread_column_appears_only_when_a_level_is_asked_for() -> None:
    sql = _one(ReportRequest(stats=["bb_per_100"]))
    assert "AS bb_per_100" in sql and "stddevSamp" not in sql


def test_only_a_per_hundred_stat_gets_a_spread_column() -> None:
    # A proportion's Wilson interval needs the value and n, both already there; a ratio and a
    # count get no interval at all, so neither gets the extra aggregate (ADR-040).
    request = ReportRequest(stats=["vpip", "af_flop", "hands"], confidence=95)
    sql = "\n".join(_build(request))
    assert "stddevSamp" not in sql
    for code in ("vpip", "af_flop", "hands"):
        assert f" AS {code}__n" in sql


def test_asking_for_an_interval_takes_a_per_hundred_stat_off_the_rollup() -> None:
    # The rollup sums a daily total and a daily count and stores no sum of squares, so the
    # per-hand spread cannot be recovered from it at any price (plan E.2).
    rollup = _one(ReportRequest(stats=["bb_per_100"]))
    facts = _one(ReportRequest(stats=["bb_per_100"], confidence=95))
    assert "stats_daily" in rollup and "sum(s.bb_per_100_action)" in rollup
    assert "player_hands" in facts and "stddevSamp(s.net_won_bb)" in facts


def test_a_proportion_keeps_the_rollup_even_with_a_level() -> None:
    sql = _one(ReportRequest(stats=["vpip", "hands"], confidence=95))
    assert "stats_daily" in sql and "stddevSamp" not in sql


def test_every_per_hundred_stat_in_the_registry_has_a_spread_column() -> None:
    """The `dispersion` property must cover all four, not only `bb_per_100`."""
    per100 = [s.code for s in registry().stats.values() if s.format == "per100"]
    assert len(per100) == 4
    sql = "\n".join(_build(ReportRequest(stats=per100, confidence=95)))
    for code in per100:
        assert f" AS {code}__sd" in sql, code
