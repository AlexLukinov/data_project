"""`run_report` end to end with a fake database: merging, totals, baselines, the cache."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from stats.ast import parse_node
from stats.request import ReportRequest, ReportResult
from stats.service import run_report

Row = tuple[Any, ...]


class FakeDB:
    """Answers each query from a canned table keyed by the mart it reads; records the SQL."""

    def __init__(self, answers: dict[str, tuple[list[str], list[Row]]]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, sql: str, params: Mapping[str, Any]) -> tuple[list[str], list[Row]]:
        self.calls.append((sql, dict(params)))
        # The rollup is read as a union of its two producers (ADR-047); a fact table as itself.
        table = (
            "stats_daily" if "stats_daily_mv" in sql else sql.split(" AS s")[0].rsplit(".", 1)[1]
        )
        key = (
            f"{table}:{params['dataset']}"
            if f"{table}:{params['dataset']}" in self.answers
            else table
        )
        return self.answers[key]


class FakeCache:
    def __init__(self) -> None:
        self.store: dict[str, Any] = {}

    def get_json(self, key: str) -> Any | None:
        return self.store.get(key)

    def set_json(self, key: str, value: Any) -> None:
        self.store[key] = value


def test_ungrouped_report_from_the_rollup() -> None:
    db = FakeDB(
        {
            "stats_daily": (
                ["vpip", "vpip__n", "hands", "hands__n", "__hands"],
                [(24.5, 1000, 1000, 1000, 1000)],
            )
        }
    )
    result = run_report(ReportRequest(stats=["vpip", "hands"]), tenant_id=1, run=db)
    assert result.hands == 1000
    assert result.rows[0].cells["vpip"].value == 24.5 and result.rows[0].cells["vpip"].n == 1000
    assert [s.code for s in result.stats] == ["vpip", "hands"]
    assert result.stats[0].format == "percent" and result.stats[0].label == "VPIP"
    assert len(db.calls) == 1 and db.calls[0][1]["tenant_id"] == 1


def test_two_plans_merge_on_the_group_key() -> None:
    """Hand-grain and decision-grain stats come from two queries and land in one row."""
    db = FakeDB(
        {
            "player_hands": (
                ["position", "vpip", "vpip__n", "__hands"],
                [("BTN", 30.0, 400, 400), ("BB", 40.0, 500, 500)],
            ),
            "decisions": (
                ["position", "cbet_flop", "cbet_flop__n", "__hands"],
                [("BTN", 60.0, 50, 90), ("CO", 55.0, 20, 40)],
            ),
        }
    )
    request = ReportRequest(
        stats=["vpip", "cbet_flop"],
        group_by=["position"],
        filter=parse_node({"dim": "hand_class", "op": "eq", "value": "AKs"}),
    )
    result = run_report(request, tenant_id=1, run=db)
    rows = {row.group["position"]: row for row in result.rows}
    assert set(rows) == {"BTN", "BB", "CO"}
    assert rows["BTN"].cells["vpip"].value == 30.0 and rows["BTN"].cells["cbet_flop"].n == 50
    assert "cbet_flop" not in rows["BB"].cells  # no decision row for that group
    assert rows["BTN"].hands == 400 and rows["CO"].hands == 40
    assert result.hands == 400 + 500 + 40
    assert len(db.calls) == 2


def test_population_baseline_attaches_deltas() -> None:
    db = FakeDB(
        {
            "stats_daily:hero": (["vpip", "vpip__n", "__hands"], [(24.5, 1000, 1000)]),
            "stats_daily:population": (
                ["vpip", "vpip__n", "__hands"],
                [(22.0, 5_000_000, 5_000_000)],
            ),
        }
    )
    request = ReportRequest(stats=["vpip"], compare_to="population")
    result = run_report(request, tenant_id=1, run=db)
    cell = result.rows[0].cells["vpip"]
    assert (cell.value, cell.baseline, cell.baseline_n, cell.delta) == (24.5, 22.0, 5_000_000, 2.5)
    hero_call, pool_call = db.calls
    assert hero_call[1]["dataset"] == "hero" and "s.is_hero = 1" in hero_call[0]
    assert pool_call[1]["dataset"] == "population" and "is_hero" not in pool_call[0]


def test_cache_round_trip_is_tenant_scoped() -> None:
    db = FakeDB({"stats_daily": (["vpip", "vpip__n", "__hands"], [(24.5, 1000, 1000)])})
    cache = FakeCache()
    request = ReportRequest(stats=["vpip"])
    first = run_report(request, tenant_id=1, run=db, cache=cache)
    second = run_report(request, tenant_id=1, run=db, cache=cache)
    assert not first.cached and second.cached
    assert second.model_copy(update={"cached": False}) == first
    assert len(db.calls) == 1
    assert all(key.startswith("report:1:") for key in cache.store)
    run_report(request, tenant_id=2, run=db, cache=cache)
    assert len(db.calls) == 2  # another tenant never sees tenant 1's cached block


def test_empty_result_is_zero_hands_not_an_error() -> None:
    db = FakeDB({"stats_daily": (["vpip", "vpip__n", "__hands"], [])})
    result = run_report(ReportRequest(stats=["vpip"]), tenant_id=1, run=db)
    assert result == ReportResult(hands=0, group_by=[], stats=result.stats, rows=[])


def test_no_confidence_level_means_no_interval_anywhere() -> None:
    db = FakeDB({"stats_daily": (["vpip", "vpip__n", "__hands"], [(24.5, 1000, 1000)])})
    result = run_report(ReportRequest(stats=["vpip"]), tenant_id=1, run=db)
    assert result.rows[0].cells["vpip"].interval is None
    assert "stddevSamp" not in db.calls[0][0]


def test_a_proportion_carries_its_wilson_interval_and_its_own_n() -> None:
    db = FakeDB({"stats_daily": (["vpip", "vpip__n", "__hands"], [(50.0, 100, 100)])})
    result = run_report(ReportRequest(stats=["vpip"], confidence=95), tenant_id=1, run=db)
    interval = result.rows[0].cells["vpip"].interval
    assert interval is not None
    assert (interval.low, interval.high) == (40.38, 59.62)  # Wilson on 50 of 100
    assert (interval.n, interval.level, interval.method) == (100, 95, "wilson")


def test_a_per_hundred_stat_reads_the_spread_column_the_query_asked_for() -> None:
    db = FakeDB(
        {
            "player_hands": (
                ["bb_per_100", "bb_per_100__n", "bb_per_100__sd", "__hands"],
                [(-1.37, 10_000, 1.0, 10_000)],
            )
        }
    )
    request = ReportRequest(stats=["bb_per_100"], confidence=95)
    result = run_report(request, tenant_id=1, run=db)
    interval = result.rows[0].cells["bb_per_100"].interval
    assert interval is not None
    assert (interval.low, interval.high) == (-3.33, 0.59)  # -1.37 ∓ 100 · 1.959964 / sqrt(10000)
    assert interval.method == "normal" and interval.n == 10_000
    assert "stddevSamp(s.net_won_bb) AS bb_per_100__sd" in db.calls[0][0]


def test_a_missing_spread_column_leaves_the_cell_without_an_interval() -> None:
    # Belt and braces: if a plan ever answers a per-100 stat without the companion column,
    # the cell says nothing rather than inventing a band.
    db = FakeDB({"player_hands": (["bb_per_100", "bb_per_100__n", "__hands"], [(-1.37, 900, 900)])})
    request = ReportRequest(stats=["bb_per_100"], confidence=95)
    result = run_report(request, tenant_id=1, run=db)
    cell = result.rows[0].cells["bb_per_100"]
    assert cell.value == -1.37 and cell.n == 900 and cell.interval is None


def test_the_population_baseline_is_asked_without_an_interval() -> None:
    # Only the baseline's value and n are attached to a cell, so carrying the level into the
    # pool query would drop a whole-pool per-100 report off the rollup for nothing.
    db = FakeDB(
        {
            "stats_daily:hero": (["vpip", "vpip__n", "__hands"], [(24.5, 1000, 1000)]),
            "stats_daily:population": (["vpip", "vpip__n", "__hands"], [(22.0, 5_000_000, 5e6)]),
        }
    )
    request = ReportRequest(stats=["vpip"], compare_to="population", confidence=95)
    cell = run_report(request, tenant_id=1, run=db).rows[0].cells["vpip"]
    assert cell.interval is not None and cell.interval.n == 1000  # hero's own, not the pool's
    assert (cell.baseline, cell.baseline_n, cell.delta) == (22.0, 5_000_000, 2.5)


def test_the_level_is_part_of_the_cache_key() -> None:
    db = FakeDB({"stats_daily": (["vpip", "vpip__n", "__hands"], [(50.0, 100, 100)])})
    cache = FakeCache()
    run_report(ReportRequest(stats=["vpip"]), tenant_id=1, run=db, cache=cache)
    run_report(ReportRequest(stats=["vpip"], confidence=95), tenant_id=1, run=db, cache=cache)
    assert len(db.calls) == 2 and len(cache.store) == 2
