"""Pool services: the dataset gate, cohort scoping, player lookup, cohort members."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from analysis.pool import cohorts
from analysis.pool.service import MAX_PLAYERS, players, pool_report
from stats.errors import ReportError
from stats.request import CohortRule, CohortSpec, ReportRequest

REGS = CohortSpec(
    rules=[
        CohortRule(stat="vpip", op="lt", value=25),
        CohortRule(stat="hands", op="gte", value=1000),
    ]
)


class Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(
        self, sql: str, params: Mapping[str, Any]
    ) -> tuple[list[str], list[tuple[Any, ...]]]:
        self.calls.append((sql, dict(params)))
        return ["vpip", "vpip__n", "__hands"], []


def test_pool_report_reads_the_population_only() -> None:
    with pytest.raises(ReportError, match="population dataset"):
        pool_report(ReportRequest(stats=["vpip"]), 7, run=Recorder())


def test_pool_report_attaches_the_cohort() -> None:
    db = Recorder()
    request = ReportRequest(dataset="population", hero_only=False, stats=["vpip"])
    pool_report(request, 7, cohort=REGS, run=db)
    sql, params = db.calls[0]
    assert " IN (SELECT c.player_key" in sql and params["p0"] == 25 and params["tenant_id"] == 7


def test_pool_report_scopes_one_opponent_inside_the_cohort() -> None:
    db = Recorder()
    request = ReportRequest(
        dataset="population", hero_only=False, stats=["vpip"], player_key="villain42"
    )
    pool_report(request, 7, cohort=REGS, run=db)
    sql, params = db.calls[0]
    assert "s.player_key = {player_key:String}" in sql and " IN (SELECT c.player_key" in sql
    assert params["player_key"] == "villain42"


def test_player_lookup_groups_the_rollup_by_player_with_a_bound_prefix() -> None:
    db = Recorder()
    players("vill", 7, limit=10_000, run=db)
    sql, params = db.calls[0]
    assert "GROUP BY player_key ORDER BY player_key" in sql and "marts.stats_daily AS s" in sql
    assert "startsWith(s.player_key, {p0:String})" in sql and params["p0"] == "vill"
    assert params["limit"] == MAX_PLAYERS and "s.is_hero = 1" not in sql


def test_members_are_the_pool_grouped_by_player_inside_the_cohort() -> None:
    request = cohorts.members_request(REGS, limit=99_999)
    assert request.group_by == ["player_key"] and request.cohort == REGS
    assert request.limit == cohorts.MAX_MEMBERS and "hands" in request.stats
    db = Recorder()
    cohorts.members(REGS, 7, run=db)
    assert " IN (SELECT c.player_key" in db.calls[0][0]
