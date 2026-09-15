"""Cohorts in the engine: validation, the rollup subquery, and the size query."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from core.settings import get_settings
from stats.cohort import cohort_size, cohort_size_query
from stats.errors import ReportError
from stats.query import build_query
from stats.registry import registry
from stats.request import CohortRule, CohortSpec, ReportRequest
from stats.resolve import dimensions_used, resolve_stats
from stats.router import plan

REGS = CohortSpec(
    rules=[
        CohortRule(stat="vpip", op="lt", value=25),
        CohortRule(stat="hands", op="gte", value=1000),
    ]
)
MARTS = get_settings().db("marts")  # `test_marts` under `make test-all`, `marts` otherwise
MEMBERS = (
    f"SELECT c.player_key FROM {MARTS}.stats_daily AS c WHERE c.user_id = {{tenant_id:UInt32}}"
    " AND c.dataset = {dataset:String} AND c.player_key != '' GROUP BY c.player_key"
    " HAVING round(100 * sum(c.vpip_action) / nullIf(sum(c.vpip_opp), 0), 2) < {p0:Float64}"
    " AND sum(c.hands) >= {p1:Float64}"
)


def _queries(request: ReportRequest, tenant_id: int = 7) -> list[tuple[str, dict[str, Any]]]:
    reg = registry()
    stats = resolve_stats(request, reg)
    return [
        build_query(request, tenant_id, p, reg) for p in plan(stats, dimensions_used(request), reg)
    ]


def test_cohort_needs_population_or_a_baseline() -> None:
    with pytest.raises(ValueError, match="cohort applies to the population"):
        ReportRequest(cohort=REGS)
    ReportRequest(dataset="population", hero_only=False, cohort=REGS)
    ReportRequest(cohort=REGS, compare_to="population")


def test_cohort_becomes_a_rollup_subquery_bound_by_parameters() -> None:
    request = ReportRequest(
        dataset="population", hero_only=False, stats=["vpip"], group_by=["position"], cohort=REGS
    )
    ((sql, params),) = _queries(request)
    # The rollup is read as the union of its two producers (ADR-047); the cohort itself is
    # evaluated on dbt's rollup alone, whole-history stats being what a cohort is defined by.
    assert "marts.stats_daily AS r" in sql and ") AS s WHERE s.user_id" in sql
    assert f"s.player_key IN ({MEMBERS})" in sql
    assert params["p0"] == 25 and params["p1"] == 1000 and params["dataset"] == "population"
    assert params["tenant_id"] == 7


def test_cohort_uses_the_fact_tables_player_column() -> None:
    request = ReportRequest(dataset="population", hero_only=False, stats=["af_flop"], cohort=REGS)
    ((sql, params),) = _queries(request)
    # af_flop binds p0..p3 first; the cohort's thresholds follow.
    members = MEMBERS.replace("{p0:Float64}", "{p4:Float64}").replace(
        "{p1:Float64}", "{p5:Float64}"
    )
    assert "marts.decisions AS s" in sql and f"s.player_key_norm IN ({members})" in sql
    assert params["p4"] == 25 and params["p5"] == 1000


def test_cohort_on_a_hero_request_scopes_only_the_baseline() -> None:
    request = ReportRequest(stats=["vpip"], cohort=REGS, compare_to="population")
    ((mine, _),) = _queries(request)
    ((pool, params),) = _queries(request.baseline())
    assert " IN (" not in mine
    assert f"s.player_key IN ({MEMBERS})" in pool and params["dataset"] == "population"


@pytest.mark.parametrize(
    ("rule", "message"),
    [
        (CohortRule(stat="af_flop", op="gt", value=2), "only cached stats"),
        (CohortRule(stat="nope", op="gt", value=2), "unknown stat"),
    ],
)
def test_cohort_rules_are_checked_against_the_registry(rule: CohortRule, message: str) -> None:
    request = ReportRequest(
        dataset="population", hero_only=False, stats=["vpip"], cohort=CohortSpec(rules=[rule])
    )
    with pytest.raises(ReportError, match=message):
        _queries(request)


def test_cohort_rules_have_a_shape() -> None:
    with pytest.raises(ValueError):
        CohortSpec(rules=[])
    with pytest.raises(ValueError):
        CohortRule(stat="vpip", op="in", value=25)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        CohortRule(stat="vpip; DROP TABLE x", op="lt", value=25)


def test_cohort_size_counts_the_same_subquery() -> None:
    sql, params = cohort_size_query(REGS, 7, registry())
    assert sql == f"SELECT count() AS players FROM ({MEMBERS})"
    assert params == {"tenant_id": 7, "dataset": "population", "p0": 25, "p1": 1000}

    def run(sql: str, params: Mapping[str, Any]) -> tuple[list[str], list[tuple[Any, ...]]]:
        return ["players"], [(7711,)]

    assert cohort_size(REGS, 7, run=run) == 7711
