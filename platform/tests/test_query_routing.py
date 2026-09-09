"""Query compiler tests — source routing and the dataset guard.

Two bodies of hands share a tenant: the user's own play and millions of observed pool hands.
Defaulting to the wrong one does not raise — it silently returns a win rate averaged over
hands the user never played, which is worse than an error because it looks plausible.

Like `test_query_compiler.py` these run without the stack and assert on the generated SQL.
"""

from __future__ import annotations

from datetime import date

import pytest

from api.queries import FACT_TABLE, ROLLUP_TABLE, StatsQuery, TimelineQuery, coerce_filters


def test_dataset_defaults_to_hero_only() -> None:
    """A query nobody configured must measure the user's OWN hands, never the pool."""
    sql, params = StatsQuery(tenant_id=1).build()
    assert "s.dataset = {dataset:String}" in sql
    assert params["dataset"] == "hero"


def test_population_dataset_is_opt_in() -> None:
    """Pool baselines are reachable, but only by asking for them explicitly.

    The pool has no hero seat, so the seat gate must be off there or the query matches
    nothing -- which is exactly how the whole population corpus was once unreachable.
    """
    sql, params = StatsQuery(tenant_id=1, dataset="population", hero_only=False).build()
    assert params["dataset"] == "population"
    assert "is_hero" not in sql


def test_population_with_hero_only_is_a_contradiction() -> None:
    with pytest.raises(ValueError, match="hero_only cannot be combined"):
        StatsQuery(tenant_id=1, dataset="population")


def test_unknown_dataset_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown dataset"):
        StatsQuery(tenant_id=1, dataset="everything")  # type: ignore[arg-type]


def test_dataset_is_not_a_filter() -> None:
    """Regression for AUDIT B1: `dataset` as a filter contradicted the scalar predicate and
    silently returned zero rows. It must be rejected like any unknown filter."""
    with pytest.raises(ValueError, match="unknown filter"):
        StatsQuery(tenant_id=1, filters={"dataset": ["population"]})


def test_timeline_fine_filter_moves_to_the_fact_table() -> None:
    """Regression for AUDIT B4: the timeline hardcoded the rollup and any fine filter was a
    runtime UNKNOWN_IDENTIFIER."""
    sql, _ = TimelineQuery(tenant_id=1, filters={"spr_bucket": ["1-3"]}).build()
    assert f"FROM {FACT_TABLE} AS s" in sql
    assert "s.played_date AS day" in sql
    sql, _ = TimelineQuery(tenant_id=1, filters={"site": ["ggpoker"]}).build()
    assert f"FROM {ROLLUP_TABLE} AS s" in sql
    assert "s.day AS day" in sql


def test_timeline_carries_the_dataset_guard() -> None:
    sql, params = TimelineQuery(tenant_id=1).build()
    assert "s.dataset = {dataset:String}" in sql and "s.is_hero = 1" in sql
    assert params["dataset"] == "hero"
    sql, params = TimelineQuery(tenant_id=1, dataset="population").build()
    assert params["dataset"] == "population"
    assert "is_hero" not in sql


def test_coarse_dimensions_use_the_rollup() -> None:
    """Cheap questions stay on the small pre-aggregated table."""
    sql, _ = StatsQuery(tenant_id=1, group_by=["position"], filters={"site": ["ggpoker"]}).build()
    assert f"FROM {ROLLUP_TABLE} AS s" in sql
    assert "s.day >= " not in sql  # no date bounds requested


def test_fine_dimensions_fall_through_to_the_fact_table() -> None:
    """Anything the rollup cannot answer must silently move to the full per-hand grain."""
    sql, _ = StatsQuery(tenant_id=1, group_by=["spr_bucket"]).build()
    assert f"FROM {FACT_TABLE} AS s" in sql


def test_fine_filter_switches_the_date_column_too() -> None:
    """The two tables name their date column differently; routing must carry that with it."""
    sql, _ = StatsQuery(
        tenant_id=1, date_from=date(2025, 1, 1), filters={"hand_class": ["AKs"]}
    ).build()
    assert f"FROM {FACT_TABLE} AS s" in sql
    assert "s.played_date >= {date_from:Date}" in sql
    assert "s.day" not in sql


def test_integer_filters_are_coerced_from_text() -> None:
    """Regression for AUDIT B7: JSON delivered `["1"]` for an `Array(UInt8)` dimension."""
    coerced = coerce_filters({"is_ip": ["1"], "players_to_flop": [2, "3"], "site": ["ggpoker"]})
    assert coerced == {"is_ip": [1], "players_to_flop": [2, 3], "site": ["ggpoker"]}
    sql, params = StatsQuery(tenant_id=1, filters=coerced).build()
    assert "{f_is_ip:Array(UInt8)}" in sql and params["f_is_ip"] == [1]


def test_non_integer_for_integer_filter_is_rejected() -> None:
    with pytest.raises(ValueError, match="expects integer"):
        coerce_filters({"is_ip": ["yes"]})


def test_unknown_filter_survives_coercion_to_be_rejected_by_the_query() -> None:
    with pytest.raises(ValueError, match="unknown filter"):
        StatsQuery(tenant_id=1, filters=coerce_filters({"password_hash": ["x"]}))


def test_unknown_fine_dimension_is_still_rejected() -> None:
    """Widening the vocabulary must not widen the allowlist's escape hatches."""
    with pytest.raises(ValueError, match="unknown filter"):
        StatsQuery(tenant_id=1, filters={"board_texture; DROP TABLE core.hands": ["x"]})
