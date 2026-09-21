"""Pool services: the dataset gate, cohort scoping, player lookup, cohort members."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from analysis.pool import cohorts
from analysis.pool.service import (
    MAX_MATCHES,
    MAX_PLAYERS,
    MIN_NAME,
    PLAYER_STATS,
    players,
    pool_report,
)
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


class Pool:
    """A runner answering one lookup with the players it is given, `ORDER BY player_key`."""

    def __init__(self, hands: dict[str, int]) -> None:
        self.hands = hands
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(
        self, sql: str, params: Mapping[str, Any]
    ) -> tuple[list[str], list[tuple[Any, ...]]]:
        self.calls.append((sql, dict(params)))
        columns = ["player_key"]
        for code in PLAYER_STATS:
            columns += [code, f"{code}__n"]
        return [*columns, "__hands"], [
            (key, *[v for _ in PLAYER_STATS for v in (1.0, n)], n)
            for key, n in sorted(self.hands.items())
        ]


def test_a_typed_name_is_matched_inside_the_name_half_and_never_against_the_site() -> None:
    """The bug this route had: a `player_key` is `<site>:<name>` and no name starts a key."""
    db = Recorder()
    players("vill", 7, limit=10_000, run=db)
    sql, params = db.calls[0]
    # The rollup arrives as the union of its two producers (ADR-047), aliased `s` as before.
    assert "GROUP BY player_key ORDER BY player_key" in sql and "marts.stats_daily AS r" in sql
    assert "s.player_key LIKE {p0:String}" in sql and "startsWith" not in sql
    assert params["p0"] == "%:%vill%" and "s.is_hero = 1" not in sql
    assert params["limit"] == MAX_MATCHES, "every match is counted; the cut is made after"


def test_a_site_typed_before_the_name_must_match_the_site_exactly() -> None:
    """What a key pasted back out of an answer is, and the only thing it can mean."""
    db = Recorder()
    players("GGPoker:ViLL", 7, run=db)
    assert db.calls[0][1]["p0"] == "ggpoker:%vill%"


@pytest.mark.parametrize("typed", ["Villain: vill", "vill:", "vill:lain", ":vill"])
def test_a_colon_that_is_not_a_site_is_part_of_the_name_typed(typed: str) -> None:
    """People paste "Name: something", and a screen name may hold a colon of its own.

    Reading every left half as a site would search for a site that does not exist and answer
    "no such player" -- the false absence this route was fixed for, one layer up.
    """
    db = Recorder()
    players(typed, 7, run=db)
    assert db.calls[0][1]["p0"] == f"%:%{typed.strip().lower()}%"


def test_a_wildcard_typed_as_a_character_is_matched_as_one() -> None:
    db = Recorder()
    players(r"a_b%c\d", 7, run=db)
    assert db.calls[0][1]["p0"] == r"%:%a\_b\%c\\d%"


@pytest.mark.parametrize("typed", ["vi", "ggpoker:vi", "  v  "])
def test_a_name_under_the_minimum_is_refused_rather_than_answered(typed: str) -> None:
    """The minimum is on the name half: a site makes the text longer, not the name."""
    db = Recorder()
    with pytest.raises(ReportError, match=f"at least {MIN_NAME} characters"):
        players(typed, 7, run=db)
    assert db.calls == [], "nothing that wide should reach ClickHouse"


def test_the_name_typed_ranks_above_a_busier_one_that_merely_contains_it() -> None:
    db = Pool({"ggpoker:vill": 269, "ggpoker:villain42": 56_761, "ggpoker:avilla": 900})
    answer = players("vill", 7, run=db)
    assert [row.group["player_key"] for row in answer.rows] == [
        "ggpoker:vill",
        "ggpoker:villain42",
        "ggpoker:avilla",
    ]


def test_the_rest_are_the_busiest_first_and_the_answer_says_how_many_matched() -> None:
    db = Pool({f"ggpoker:vill{i:03}": i for i in range(300)})
    answer = players("vill", 7, limit=10, run=db)
    assert answer.matched == 300 and len(answer.rows) == 10
    assert [row.hands for row in answer.rows] == list(range(299, 289, -1))
    assert answer.matched_capped is False
    assert answer.hands == sum(range(300)), "the total is over everyone who matched"


def test_a_limit_above_the_ceiling_is_the_ceiling() -> None:
    db = Pool({f"ggpoker:vill{i:04}": i for i in range(MAX_PLAYERS + 5)})
    assert len(players("vill", 7, limit=10_000, run=db).rows) == MAX_PLAYERS


def test_a_lookup_that_counts_all_it_will_count_says_the_count_is_a_floor() -> None:
    db = Pool({f"ggpoker:vill{i:05}": i for i in range(MAX_MATCHES)})
    answer = players("vill", 7, run=db)
    assert answer.matched == MAX_MATCHES and answer.matched_capped is True


def test_members_are_the_pool_grouped_by_player_inside_the_cohort() -> None:
    request = cohorts.members_request(REGS, limit=99_999)
    assert request.group_by == ["player_key"] and request.cohort == REGS
    assert request.limit == cohorts.MAX_MEMBERS and "hands" in request.stats
    db = Recorder()
    cohorts.members(REGS, 7, run=db)
    assert " IN (SELECT c.player_key" in db.calls[0][0]
