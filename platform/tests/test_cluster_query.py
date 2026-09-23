"""The two-level query a clustered report compiles to, and the request rules around it (G.3).

Like `test_report_query.py`, these need no stack: they assert on the SQL the builder produces,
on the table the router picks, and on what `run_report` makes of a clustered row.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from stats.ast import parse_node
from stats.cluster_query import build_clustered
from stats.registry import registry
from stats.request import CohortRule, CohortSpec, CohortUnion, CustomStatSpec, ReportRequest
from stats.resolve import dimensions_used, resolve_stats
from stats.router import plan
from stats.service import run_report, validate_request

POOL: dict[str, Any] = {
    "dataset": "population",
    "hero_only": False,
    "confidence": 95,
    "cluster": "player",
}


def _one(request: ReportRequest, tenant_id: int = 1) -> tuple[str, dict[str, Any]]:
    reg = registry()
    stats = resolve_stats(request, reg)
    plans = plan(stats, dimensions_used(request), reg, dispersion=True, cluster=True)
    assert len(plans) == 1
    return build_clustered(request, tenant_id, plans[0], reg)


def test_a_decision_stat_aggregates_per_player_first_then_over_players() -> None:
    sql, params = _one(
        ReportRequest(**POOL, stats=["fold_to_cbet_flop"], group_by=["position"]), 42
    )
    inner = sql[sql.index("FROM (") + 6 : sql.index(") AS s GROUP BY position")]
    # Tenant first, in the inner level, where the rows are.
    assert inner.startswith("SELECT s.position AS position, s.player_key_norm AS __player, ")
    assert "WHERE s.user_id = {tenant_id:UInt32} AND s.dataset = {dataset:String}" in inner
    assert inner.endswith("GROUP BY position, __player")
    assert params["tenant_id"] == 42 and params["dataset"] == "population"
    # The per-player halves, and the hands as a partial state.
    assert " AS fold_to_cbet_flop__x, " in inner and " AS fold_to_cbet_flop__n, " in inner
    assert "uniqCombined64State(20)(s.hand_uid) AS __hands" in inner
    # The outer level: the same value and n the flat query gives, plus the five cluster sums.
    outer = sql[: sql.index("FROM (")]
    assert (
        "round(100 * sum(s.fold_to_cbet_flop__x) / nullIf(sum(s.fold_to_cbet_flop__n), 0), 2)"
        " AS fold_to_cbet_flop, sum(s.fold_to_cbet_flop__n) AS fold_to_cbet_flop__n, "
        "sum(s.fold_to_cbet_flop__x) AS fold_to_cbet_flop__x, "
        "countIf(s.fold_to_cbet_flop__n > 0) AS fold_to_cbet_flop__k, "
        "sum(s.fold_to_cbet_flop__x * s.fold_to_cbet_flop__x) AS fold_to_cbet_flop__xx, "
        "sum(s.fold_to_cbet_flop__x * s.fold_to_cbet_flop__n) AS fold_to_cbet_flop__xn, "
        "sum(s.fold_to_cbet_flop__n * s.fold_to_cbet_flop__n) AS fold_to_cbet_flop__nn, "
        "uniqCombined64Merge(20)(s.__hands) AS __hands "
    ) in outer
    assert sql.endswith(") AS s GROUP BY position ORDER BY position LIMIT {limit:UInt32}")


def test_a_hand_stat_reads_the_hand_table_and_adds_its_rows_up() -> None:
    sql, _ = _one(ReportRequest(**POOL, stats=["vpip"]))
    assert "marts.player_hands AS s" in sql
    assert "count() AS __hands" in sql and "sum(s.__hands) AS __hands" in sql
    assert sql.endswith("GROUP BY __player) AS s GROUP BY () LIMIT {limit:UInt32}")


def test_a_bucketed_dimension_is_bucketed_before_the_player_is_grouped() -> None:
    """A player whose rows fall in two raw values of one bucket is ONE cluster in it."""
    sql, _ = _one(ReportRequest(**POOL, stats=["fold_to_cbet_flop"], group_by=["eff_stack_bb"]))
    inner = sql[sql.index("FROM (") + 6 :]
    assert inner.startswith("SELECT multiIf(s.eff_stack_bb < ")
    assert " AS eff_stack_bb, s.player_key_norm AS __player, " in inner
    assert "GROUP BY eff_stack_bb, __player) AS s GROUP BY eff_stack_bb" in sql
    assert sql.startswith("SELECT s.eff_stack_bb AS eff_stack_bb, ")


def test_the_cohort_and_the_filter_scope_the_inner_level() -> None:
    regs = CohortSpec(rules=[CohortRule(stat="vpip", op="lt", value=25)])
    request = ReportRequest(
        **POOL,
        stats=["fold_to_cbet_flop"],
        filter=parse_node({"dim": "street", "op": "eq", "value": "flop"}),
        cohort=regs,
    )
    sql, params = _one(request)
    inner = sql[sql.index("FROM (") : sql.index(") AS s GROUP BY ()")]
    # The stat's own leaves bind first (p0..p6); the filter is p7 and the cohort's threshold p8.
    assert "(s.street = {p7:String})" in inner and params["p7"] == "flop"
    assert "s.player_key_norm IN (SELECT c.player_key FROM" in inner
    assert "< {p8:Float64}" in inner and params["p8"] == 25


def test_a_count_and_a_ratio_carry_no_cluster_sums() -> None:
    counted, _ = _one(ReportRequest(**POOL, stats=["hands"]))
    assert "__k" not in counted and "__xx" not in counted
    assert "sum(s.hands__x) AS hands, sum(s.hands__x) AS hands__n" in counted
    ratio, _ = _one(ReportRequest(**POOL, stats=["af_flop"]))
    assert "__k" not in ratio and "__xx" not in ratio
    assert "AS af_flop, sum(s.af_flop__n) AS af_flop__n" in ratio


def test_a_clustered_report_never_reads_the_rollup() -> None:
    reg = registry()
    request = ReportRequest(**POOL, stats=["vpip", "hands"])
    stats = resolve_stats(request, reg)
    flat = plan(stats, dimensions_used(request), reg, dispersion=True)
    clustered = plan(stats, dimensions_used(request), reg, dispersion=True, cluster=True)
    assert [p.table for p in flat] == ["stats_daily"]
    assert [p.table for p in clustered] == ["player_hands"]


def test_cluster_needs_a_level_and_the_population() -> None:
    with pytest.raises(ValidationError, match="cluster needs a confidence level"):
        ReportRequest(dataset="population", hero_only=False, cluster="player")
    with pytest.raises(ValidationError, match="population dataset"):
        ReportRequest(confidence=95, cluster="player")
    with pytest.raises(ValidationError):
        ReportRequest(**{**POOL, "cluster": "hand"})
    # One player's report is not a pool inference: K = 1 would bracket the whole axis.
    with pytest.raises(ValidationError, match="one player's report is binomial"):
        ReportRequest(**POOL, stats=["vpip"], player_key="ggpoker:someone")
    # A baseline is the pool's plain answer: no interval, so no clustering either.
    hero = ReportRequest(stats=["vpip"], confidence=95, compare_to="population")
    assert hero.baseline().cluster is None and hero.baseline().confidence is None


def test_validate_request_builds_the_clustered_query_too() -> None:
    validate_request(ReportRequest(**POOL, stats=["fold_to_cbet_flop"], group_by=["position"]))


def test_run_report_reads_a_clustered_row_into_a_clustered_cell() -> None:
    columns = [
        "fold_to_cbet_flop",
        "fold_to_cbet_flop__n",
        "fold_to_cbet_flop__x",
        "fold_to_cbet_flop__k",
        "fold_to_cbet_flop__xx",
        "fold_to_cbet_flop__xn",
        "fold_to_cbet_flop__nn",
        "__hands",
    ]
    # 40 identical players, 25 rows each, 15 folds each: design effect exactly 1.
    row = (60.0, 1000, 600, 40, 40 * 225, 40 * 375, 40 * 625, 1000)

    def db(sql: str, params: Mapping[str, Any]) -> tuple[list[str], list[tuple[Any, ...]]]:
        assert "__player" in sql
        return columns, [row]

    result = run_report(ReportRequest(**POOL, stats=["fold_to_cbet_flop"]), tenant_id=1, run=db)
    cell = result.rows[0].cells["fold_to_cbet_flop"]
    assert cell.value == 60.0 and cell.n == 1000 and cell.players == 40
    assert cell.interval is not None and cell.interval.method == "cluster"
    assert cell.interval.players == 40 and cell.interval.design_effect == 1.0
    assert result.stats[0].kind == "chosen"


def test_a_dealt_custom_stat_is_clustered_like_any_other_and_says_its_kind() -> None:
    """The kind picks the gate, not the estimator (ADR-076, as measured)."""
    pairs = CustomStatSpec(
        code="pairs",
        grain="decision",
        format="percent",
        kind="dealt",
        numerator=parse_expr({"countIf": {"dim": "hand_shape", "op": "eq", "value": "pair"}}),
        denominator=parse_expr({"count": True}),
    )
    request = ReportRequest(**POOL, custom=[pairs])
    sql, _ = _one(request)
    assert "AS pairs__k" in sql and "AS pairs__nn" in sql
    assert resolve_stats(request, registry())[0].kind == "dealt"


def test_a_group_of_cohorts_is_one_scan_with_the_rule_sets_or_ed() -> None:
    union = CohortUnion(
        any=[
            CohortSpec(
                rules=[
                    CohortRule(stat="vpip", op="lt", value=25),
                    CohortRule(stat="hands", op="lt", value=200),
                ]
            ),
            CohortSpec(
                rules=[
                    CohortRule(stat="vpip", op="gte", value=35),
                    CohortRule(stat="hands", op="lt", value=200),
                ]
            ),
        ]
    )
    sql, params = _one(ReportRequest(**POOL, stats=["fold_to_cbet_flop"], cohort=union))
    members = sql[sql.index("IN (SELECT c.player_key") : sql.index(") GROUP BY __player")]
    assert members.count("SELECT c.player_key") == 1
    # `fold_to_cbet_flop` binds p0..p6; the two rule sets follow, each in its own parentheses.
    assert (
        " HAVING (round(100 * sum(c.vpip_action) / nullIf(sum(c.vpip_opp), 0), 2) < {p7:Float64}"
        " AND sum(c.hands) < {p8:Float64}) OR (round(100 * sum(c.vpip_action) / "
        "nullIf(sum(c.vpip_opp), 0), 2) >= {p9:Float64} AND sum(c.hands) < {p10:Float64})"
    ) in members
    assert [params[f"p{i}"] for i in range(7, 11)] == [25, 200, 35, 200]


def test_a_stat_with_a_product_or_a_quotient_inside_is_refused_not_mis_summed() -> None:
    """The sum of per-player ratios is not the ratio of the sums (ADR-089)."""
    from stats.errors import ReportError

    ratio_inside = CustomStatSpec(
        code="won_per_bb",
        grain="hand",
        format="per100",
        numerator=parse_expr({"div": [{"sum": "net_won_bb"}, {"sum": "big_blind"}]}),
        denominator=parse_expr({"count": True}),
    )
    with pytest.raises(ReportError, match="adds up over players"):
        _one(ReportRequest(**POOL, custom=[ratio_inside]))
    # A difference of counts adds up and is fine.
    difference = CustomStatSpec(
        code="not_folded",
        grain="decision",
        format="percent",
        numerator=parse_expr(
            {"sub": [{"count": True}, {"countIf": {"dim": "action", "op": "eq", "value": "fold"}}]}
        ),
        denominator=parse_expr({"count": True}),
    )
    sql, _ = _one(ReportRequest(**POOL, custom=[difference]))
    assert "AS not_folded__k" in sql


def test_every_built_in_stat_adds_up_over_players() -> None:
    from stats.cluster_query import adds_up

    for stat in registry().stats.values():
        assert adds_up(stat.numerator_expr), stat.code
        assert stat.denominator_expr is None or adds_up(stat.denominator_expr), stat.code


def parse_expr(raw: object) -> Any:
    from stats.ast import parse_expr as _parse

    return _parse(raw)
