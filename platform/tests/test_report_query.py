"""The v2 query builder and router -- the security boundary, and the table choice.

The 25 cases of the v1 compiler's tests (deleted with it in plan C.6) carried over to the
registry path (plan C.4), plus the AST-shaped injection attempts. These run without the
stack: they assert on the SQL and the parameters the builder *produces*.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from pydantic import ValidationError

from stats.ast import parse_node
from stats.errors import ReportError
from stats.query import build_query, group_expr
from stats.registry import registry
from stats.request import CustomStatSpec, ReportRequest
from stats.resolve import dimensions_used, resolve_stats
from stats.router import plan


def _build(request: ReportRequest, tenant_id: int = 1) -> list[tuple[str, dict[str, Any]]]:
    reg = registry()
    stats = resolve_stats(request, reg)
    return [
        build_query(request, tenant_id, p, reg) for p in plan(stats, dimensions_used(request), reg)
    ]


def _one(request: ReportRequest, tenant_id: int = 1) -> tuple[str, dict[str, Any]]:
    queries = _build(request, tenant_id)
    assert len(queries) == 1
    return queries[0]


# ---- tenancy and datasets ------------------------------------------------------------------


def test_tenant_is_always_in_the_where_clause() -> None:
    sql, params = _one(ReportRequest(), tenant_id=42)
    assert "s.user_id = {tenant_id:UInt32}" in sql
    assert params["tenant_id"] == 42


def test_tenant_id_is_not_a_request_field() -> None:
    """There is no way to name a tenant in a report document. That is the point."""
    with pytest.raises(ValidationError):
        ReportRequest.model_validate({"tenant_id": 2})
    with pytest.raises(ValidationError):
        ReportRequest.model_validate({"user_id": 2})


def test_dataset_defaults_to_hero_only() -> None:
    sql, params = _one(ReportRequest())
    assert "s.dataset = {dataset:String}" in sql and params["dataset"] == "hero"
    assert "s.is_hero = 1" in sql


def test_population_dataset_is_opt_in_and_drops_the_seat_gate() -> None:
    sql, params = _one(ReportRequest(dataset="population", hero_only=False))
    assert params["dataset"] == "population"
    assert "is_hero" not in sql


def test_population_with_hero_only_is_a_contradiction() -> None:
    with pytest.raises(ValidationError, match="hero_only cannot be combined"):
        ReportRequest(dataset="population")


def test_no_user_supplied_string_reaches_the_sql() -> None:
    """Every value a caller controls travels as a bound parameter, never as SQL text."""
    user_supplied = ["pokerstars:someone'; --", "pokerstars", "NL50"]
    request = ReportRequest(
        date_from=date(2026, 1, 1),
        date_to=date(2026, 2, 1),
        player_key=user_supplied[0],
        filter=parse_node(
            {
                "all": [
                    {"dim": "site", "op": "in", "value": [user_supplied[1]]},
                    {"dim": "stake_level", "op": "eq", "value": user_supplied[2]},
                ]
            }
        ),
        group_by=["position"],
        stats=["vpip", "pfr", "bb_per_100"],
    )
    sql, params = _one(request, tenant_id=7)
    for value in user_supplied:
        assert value not in sql
    assert params["player_key"] == user_supplied[0]
    assert params["date_from"] == date(2026, 1, 1)


@pytest.mark.parametrize(
    "payload",
    [
        "'; DROP TABLE core.hands; --",
        "1 OR 1=1",
        "pokerstars') OR user_id=2 --",
        "\\'; SELECT * FROM users; --",
    ],
)
def test_injection_attempts_become_bound_parameters(payload: str) -> None:
    """Hostile values reach the database as DATA, never as SQL.

    `stake_level` is a free-text dimension, so the payload is accepted and bound. An enum
    dimension would have refused it outright (next test) -- the compiler never sees it.
    """
    request = ReportRequest(
        filter=parse_node({"dim": "stake_level", "op": "in", "value": [payload]})
    )
    sql, params = _one(request)
    assert payload not in sql
    assert [payload] in params.values()
    assert "(s.stake_level IN {p" in sql and ":Array(String)})" in sql


def test_injection_through_a_dimension_name_or_enum_value_is_rejected_before_sql() -> None:
    with pytest.raises(ValidationError):
        parse_node({"dim": "site; DROP TABLE x", "op": "eq", "value": "x"})
    request = ReportRequest(filter=parse_node({"dim": "user_id", "op": "eq", "value": 2}))
    with pytest.raises(ReportError, match="unknown dimension 'user_id'"):
        _build(request)
    hostile = parse_node({"dim": "site", "op": "eq", "value": "'; DROP TABLE core.hands; --"})
    with pytest.raises(ReportError, match="is not a value of 'site'"):
        _build(ReportRequest(filter=hostile))


# ---- stats, sample sizes, formats --------------------------------------------------------


def test_every_stat_returns_its_sample_size() -> None:
    codes = [s.code for s in registry().stats.values()]
    for start in range(0, len(codes), 40):
        chunk = codes[start : start + 40]
        for sql, _ in _build(ReportRequest(stats=chunk)):
            for code in chunk:
                if f" AS {code}," in sql:
                    assert f" AS {code}__n" in sql, code


def test_division_by_zero_is_guarded_and_formats_apply() -> None:
    queries = _build(ReportRequest(stats=["vpip", "bb_per_100", "af_flop", "hands"]))
    sql = "\n".join(q for q, _ in queries)
    assert sql.count("nullIf(") >= 3
    # One uncached stat moves the whole request to the facts (plan §2.6: rollup only when
    # every stat is cached), where VPIP is a countIf over player_hands.
    assert "round(100 * countIf(s.did_vpip = {p0:UInt8}) / nullIf(count(), 0), 2) AS vpip" in sql
    assert ", 3) AS bb_per_100" in sql  # per100 keeps three decimals
    assert "AS af_flop" in sql and "round(countIf(" in sql  # a ratio has no 100x
    assert "count() AS hands, count() AS hands__n" in sql


def test_unknown_stat_and_group_by_are_rejected() -> None:
    with pytest.raises(ReportError, match="unknown stat"):
        _build(ReportRequest(stats=["definitely_not_a_stat"]))
    with pytest.raises(ReportError, match="unknown dimension 'password_hash'"):
        _build(ReportRequest(group_by=["password_hash"]))
    with pytest.raises(ReportError, match="not a group-by dimension"):
        _build(ReportRequest(group_by=["big_blind"]))


def test_limit_is_bounded() -> None:
    with pytest.raises(ValidationError):
        ReportRequest(limit=10_000_000)
    sql, params = _one(ReportRequest(limit=50))
    assert sql.endswith("LIMIT {limit:UInt32}") and params["limit"] == 50


# ---- routing: by stats AND dimensions ----------------------------------------------------


def test_cached_stats_on_coarse_dimensions_read_the_rollup() -> None:
    sql, _ = _one(ReportRequest(stats=["vpip", "threebet"], group_by=["position"]))
    assert "marts.stats_daily AS s" in sql
    assert "sum(s.threebet_action)" in sql and "sum(s.threebet_opp)" in sql
    assert "sum(s.hands) AS __hands" in sql


def test_a_fine_dimension_moves_a_cached_stat_to_its_fact_table() -> None:
    request = ReportRequest(
        stats=["fold_to_cbet_flop"],
        filter=parse_node({"dim": "spr", "op": "between", "value": [3, 6]}),
    )
    sql, params = _one(request)
    assert "marts.decisions AS s" in sql
    # Registry values are bound too: one path for every value, whoever wrote it.
    assert "countIf(s.street = {p0:String} AND s.facing = {p1:String}" in sql
    assert params["p0"] == "flop" and params["p1"] == "bet"
    assert "(s.spr BETWEEN {p7:Float64} AND {p8:Float64})" in sql
    assert params["p7"] == 3 and params["p8"] == 6
    assert "uniqCombined64(20)(s.hand_uid) AS __hands" in sql


def test_an_uncached_stat_reads_its_fact_table() -> None:
    sql, _ = _one(ReportRequest(stats=["af_flop"]))
    assert "marts.decisions AS s" in sql
    assert "round(countIf(" in sql and "nullIf(countIf(" in sql


def test_mixed_grains_become_two_queries() -> None:
    request = ReportRequest(
        stats=["vpip", "cbet_flop"],
        filter=parse_node({"dim": "hand_class", "op": "eq", "value": "AKs"}),
        group_by=["position"],
    )
    queries = _build(request)
    assert [sql.split(" AS s")[0].rsplit(".", 1)[1] for sql, _ in queries] == [
        "player_hands",
        "decisions",
    ]
    for sql, _ in queries:
        assert "GROUP BY position ORDER BY position" in sql


def test_a_decision_dimension_on_a_hand_grain_stat_is_refused() -> None:
    request = ReportRequest(
        stats=["vpip"], filter=parse_node({"dim": "facing", "op": "eq", "value": "3bet"})
    )
    with pytest.raises(ReportError, match="'facing' is not available for hand-grain stat 'vpip'"):
        _build(request)


def test_number_group_by_uses_the_registry_buckets() -> None:
    sql, _ = _one(ReportRequest(stats=["cbet_flop"], group_by=["spr"]))
    assert group_expr(registry().dimension("spr")) == (
        "multiIf(s.spr < 1, '0-1', s.spr < 3, '1-3', s.spr < 6, '3-6', s.spr < 13, '6-13', '13+')"
    )
    assert "AS spr" in sql and "GROUP BY spr" in sql


# ---- custom stats: the caller picks the denominator ------------------------------------


def _fold_to_3bet(denominator: dict[str, Any], code: str = "f3b") -> CustomStatSpec:
    situation = {
        "all": [
            {"dim": "street", "op": "eq", "value": "preflop"},
            {"dim": "facing", "op": "eq", "value": "3bet"},
        ]
    }
    return CustomStatSpec(
        code=code,
        grain="decision",
        numerator={"countIf": {"all": [situation, {"dim": "action", "op": "eq", "value": "fold"}]}},
        denominator=denominator,
    )


def test_custom_stat_lets_the_caller_pick_the_denominator() -> None:
    per_opportunity = _fold_to_3bet({"countIf": {"dim": "facing", "op": "eq", "value": "3bet"}})
    per_decision = _fold_to_3bet({"count": True}, code="f3b_per_decision")
    sql, params = _one(ReportRequest(custom=[per_opportunity, per_decision]))
    assert "countIf(s.facing = {p3:String}) AS f3b__n" in sql and params["p3"] == "3bet"
    assert "count() AS f3b_per_decision__n" in sql


def test_custom_stat_dimensions_are_checked() -> None:
    bad = CustomStatSpec(
        code="x",
        grain="hand",
        numerator={"countIf": {"dim": "password_hash", "op": "eq", "value": 1}},
        denominator={"count": True},
    )
    with pytest.raises(ReportError, match="unknown dimension 'password_hash'"):
        _build(ReportRequest(custom=[bad]))
    wrong_table = CustomStatSpec(
        code="y", grain="hand", numerator={"sum": "spr"}, denominator={"count": True}
    )
    with pytest.raises(ReportError, match="'spr' is not on table 'player_hands'"):
        _build(ReportRequest(custom=[wrong_table]))


def test_custom_stat_code_is_sanitized() -> None:
    for bad_code in ("DROP", "a b", "x); --", "1abc", ""):
        with pytest.raises(ValidationError):
            CustomStatSpec(code=bad_code, grain="hand", numerator={"count": True}, format="count")


def test_custom_stat_cannot_shadow_a_builtin_or_a_dimension() -> None:
    with pytest.raises(ReportError, match="shadows a built-in"):
        _build(ReportRequest(custom=[_fold_to_3bet({"count": True}, code="vpip")]))
    with pytest.raises(ReportError, match="is a dimension name"):
        _build(ReportRequest(custom=[_fold_to_3bet({"count": True}, code="position")]))


def test_duplicate_custom_codes_are_rejected() -> None:
    spec = _fold_to_3bet({"count": True})
    with pytest.raises(ReportError, match="duplicate stat code"):
        _build(ReportRequest(custom=[spec, spec]))


def test_custom_stats_are_still_tenant_scoped() -> None:
    sql, params = _one(ReportRequest(custom=[_fold_to_3bet({"count": True})]), tenant_id=5)
    assert "s.user_id = {tenant_id:UInt32}" in sql and params["tenant_id"] == 5
