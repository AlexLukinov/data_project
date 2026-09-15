"""The hot path is the dbt models rendered again, not a second derivation (plan E.1b, ADR-047).

These pin what `make gen` writes into `ch/hot_path/` without a database: that every gate site
became the batch predicate, that the board model is inlined rather than read from the table the
batch is not in yet, that the rows say who wrote them, and that nothing dbt-only leaked through.
The proof that the rendered rows EQUAL dbt's rows is `tests/integration/test_hot_path.py`.
"""

from __future__ import annotations

import re

import pytest

from scripts import gen_hot_path
from scripts.hot_path_sql import (
    HEADER,
    HOT_PROVENANCE,
    MODELS,
    PARTITIONS_PARAM,
    PROJECT,
    STAMP_PARAM,
    TENANT_PARAM,
    batch_predicate,
    parameters,
    render_hot_path,
)

GATE_CALLS = re.compile(r"dirty_partitions\('([^']+)'\)")


def _gate_sites(*relative: str) -> int:
    """How many times the dbt sources call the gate, across the files the render is made of."""
    return sum(len(GATE_CALLS.findall((PROJECT / path).read_text())) for path in relative)


@pytest.mark.parametrize("table", sorted(MODELS))
def test_nothing_dbt_only_survives_the_render(table: str) -> None:
    sql = render_hot_path(table)
    assert sql.startswith(HEADER)
    for leftover in ("{{", "}}", "{%", "dirty_partitions", "ref(", "config("):
        assert leftover not in sql, f"{leftover!r} reached the generated SQL"
    assert "intermediate.int_board_by_street" not in sql, (
        "the board features must be computed inline: the batch is not in the intermediate yet"
    )
    assert "'monotone'" in sql, "the board model was not inlined"


@pytest.mark.parametrize("table", sorted(MODELS))
def test_every_gate_site_became_the_batch_predicate(table: str) -> None:
    """Six sites: three in hand_arrays(), two in the model, one in the board model."""
    sql = render_hot_path(table)
    expected = _gate_sites(
        "macros/hand_arrays.sql", MODELS[table], "models/intermediate/int_board_by_street.sql"
    ) + (_gate_sites("macros/decision_state.sql") if table == "decisions" else 0)
    assert expected == 6
    assert sql.count(STAMP_PARAM) == expected
    assert sql.count(TENANT_PARAM) == expected + 1, "the anti-join is scoped to the tenant too"
    assert sql.count(PARTITIONS_PARAM) == expected + 1, "and to the batch's partitions"


def test_the_predicate_follows_the_relation_alias() -> None:
    bare = batch_predicate("played_at_utc")
    assert bare == (
        f"toYYYYMMDD(played_at_utc) in {PARTITIONS_PARAM}"
        f" and user_id = {TENANT_PARAM} and src_parsed_at = {STAMP_PARAM}"
    )
    aliased = batch_predicate("hb.played_at_utc")
    assert "toYYYYMMDD(hb.played_at_utc)" in aliased
    assert "hb.user_id = " in aliased and "hb.src_parsed_at = " in aliased


@pytest.mark.parametrize("table", sorted(MODELS))
def test_rows_say_the_worker_wrote_them_and_the_column_is_last(table: str) -> None:
    sql = render_hot_path(table)
    body = sql.split("\n", 5)[5]  # past the five comment lines of the header
    assert body.count(HOT_PROVENANCE) == 1
    assert "'dbt'" not in body
    # The outermost SELECT list -- bare names for decisions, aliases for player_hands -- ends
    # with the column, right before the FROM that opens the hand-grain subquery.
    assert re.search(r"(as |, )built_by\s*\n\s*from \(", body), "built_by must be the last column"


@pytest.mark.parametrize("table", sorted(MODELS))
def test_the_insert_is_idempotent_by_an_anti_join_on_the_target(table: str) -> None:
    sql = render_hot_path(table)
    assert sql.startswith(f"{HEADER}\n") and f"INSERT INTO marts.{table}\nSELECT * FROM (" in sql
    tail = sql[sql.rindex(") AS fresh") :]
    assert f"WHERE fresh.hand_uid NOT IN (\n    SELECT hand_uid FROM marts.{table}" in tail
    scope = f"WHERE user_id = {TENANT_PARAM} AND toYYYYMMDD(played_at_utc) IN {PARTITIONS_PARAM}"
    assert scope in tail


def test_only_the_two_fact_tables_have_a_hot_path() -> None:
    with pytest.raises(ValueError, match="no hot path for 'stats_daily'"):
        render_hot_path("stats_daily")


def test_parameters_are_named_as_the_sql_expects() -> None:
    bound = parameters(7, "stamp", [20260101, 20260102])
    assert set(bound) == {"tenant", "stamp", "partitions"}
    for name in bound:
        assert f"{{{name}:" in render_hot_path("decisions")


def test_generated_files_are_current() -> None:
    """What `make gen-check` enforces in CI, as a unit test too."""
    for path, content in gen_hot_path.expected_files().items():
        assert path.exists(), f"{path.name} missing -- run `make gen`"
        assert path.read_text() == content, f"{path.name} is stale -- run `make gen`"
