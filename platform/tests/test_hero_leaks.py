"""The leak finder: ranking, the opportunity floor, and the baseline seam."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

from analysis.hero.leaks import find_leaks
from analysis.pool.baselines import PopulationBaseline
from stats.request import CohortRule, CohortSpec, ReportRequest, ReportResult

HERO: dict[str, tuple[float | None, int]] = {
    "vpip": (30.0, 5000),
    "pfr": (11.0, 5000),
    "threebet": (5.0, 40),
    "cbet_flop": (None, 0),
}
POOL: dict[str, tuple[float | None, int]] = {
    "vpip": (24.0, 1_000_000),
    "pfr": (18.0, 1_000_000),
    "threebet": (8.0, 1_000_000),
    "cbet_flop": (55.0, 1_000_000),
}


class FakeDB:
    """Answers any rollup query from the two tables above, by the dataset parameter."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(
        self, sql: str, params: Mapping[str, Any]
    ) -> tuple[list[str], list[tuple[Any, ...]]]:
        self.calls.append((sql, dict(params)))
        table = HERO if params["dataset"] == "hero" else POOL
        codes = re.findall(r" AS ([a-z0-9_]+)__n", sql)
        columns: list[str] = []
        row: list[Any] = []
        for code in codes:
            value, n = table.get(code, (None, 0))
            columns += [code, f"{code}__n"]
            row += [value, n]
        columns.append("__hands")
        row.append(5000 if table is HERO else 1_000_000)
        return columns, [tuple(row)]


def test_leaks_are_ranked_by_deviation_times_root_n() -> None:
    db = FakeDB()
    result = find_leaks(7, provider=PopulationBaseline(run=db), run=db)
    assert result.hands == 5000 and result.min_n == 100
    assert [leak.code for leak in result.leaks] == ["pfr", "vpip"]
    pfr, vpip = result.leaks
    assert pfr.delta == -7.0 and pfr.direction == "below" and pfr.baseline == 18.0
    assert pfr.score == round(7 * math.sqrt(5000), 2) and pfr.baseline_n == 1_000_000
    assert vpip.delta == 6.0 and vpip.direction == "above" and vpip.typical == (18.0, 28.0)
    assert "threebet" in result.skipped and "cbet_flop" in result.skipped
    assert all(params["tenant_id"] == 7 for _, params in db.calls)
    assert {params["dataset"] for _, params in db.calls} == {"hero", "population"}


def test_the_floor_can_be_lowered_and_dates_pass_through() -> None:
    db = FakeDB()
    result = find_leaks(
        7,
        provider=PopulationBaseline(run=db),
        run=db,
        min_n=10,
        date_from=ReportRequest.model_fields["date_from"].get_default() or None,
    )
    assert [leak.code for leak in result.leaks] == ["pfr", "vpip", "threebet"]
    assert result.leaks[-1].score == round(3 * math.sqrt(40), 2)


def test_the_cohort_reaches_the_baseline_only() -> None:
    db = FakeDB()
    regs = CohortSpec(rules=[CohortRule(stat="vpip", op="lt", value=25)])
    find_leaks(7, provider=PopulationBaseline(run=db), run=db, cohort=regs)
    hero_sql = [sql for sql, params in db.calls if params["dataset"] == "hero"]
    pool_sql = [sql for sql, params in db.calls if params["dataset"] == "population"]
    assert hero_sql and pool_sql
    assert all(" IN (SELECT c.player_key" not in sql for sql in hero_sql)
    assert all(" IN (SELECT c.player_key" in sql for sql in pool_sql)


def test_a_custom_provider_is_asked_the_heros_question() -> None:
    asked: list[tuple[ReportRequest, int, CohortSpec | None]] = []

    class Solver:
        def baseline(
            self, request: ReportRequest, tenant_id: int, cohort: CohortSpec | None = None
        ) -> ReportResult:
            asked.append((request, tenant_id, cohort))
            return ReportResult(hands=0, group_by=[], stats=[], rows=[])

    db = FakeDB()
    result = find_leaks(7, provider=Solver(), run=db)
    assert result.leaks == [] and len(result.skipped) == sum(len(r.stats) for r, _, _ in asked)
    assert asked[0][1] == 7 and asked[0][0].dataset == "hero" and asked[0][0].hero_only
