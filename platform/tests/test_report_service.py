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
        table = sql.split(" AS s")[0].rsplit(".", 1)[1]
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
