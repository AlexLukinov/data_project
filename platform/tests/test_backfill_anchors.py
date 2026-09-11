"""The backfill loop and the dbt macro must agree on what "built" means.

`scripts/backfill.py` decides which partitions are dirty with its own SQL, and
`macros/incremental.sql` decides the same inside every model. They drifted once (monthly vs
daily) and the loop stopped early believing it was done. These tests pin the script's half:
the anchor list, its SQL, and the vars handed to dbt.
"""

from __future__ import annotations

import pytest

from scripts.anchors import (
    DEFAULT_ANCHORS,
    anchor_sql,
    dbt_vars,
    dirty_sql,
    dirty_where,
    parse_anchors,
    partition_of,
)


def test_default_anchor_is_the_last_model() -> None:
    assert parse_anchors(None) == DEFAULT_ANCHORS == (("stats_daily", "day"),)
    assert parse_anchors([]) == DEFAULT_ANCHORS


def test_anchor_flags_parse_in_order() -> None:
    anchors = parse_anchors(["decisions:played_date", "player_hands:played_date"])
    assert anchors == (("decisions", "played_date"), ("player_hands", "played_date"))


@pytest.mark.parametrize("bad", ["decisions", "decisions:", ":played_date"])
def test_malformed_anchor_flag_is_rejected(bad: str) -> None:
    with pytest.raises(SystemExit, match="TABLE:DATE_COLUMN"):
        parse_anchors([bad])


def test_single_anchor_sql_reads_one_table() -> None:
    sql = anchor_sql("test_", DEFAULT_ANCHORS)
    assert sql == (
        "SELECT toYYYYMMDD(day) AS m, max(src_parsed_at) AS built_max"
        " FROM test_marts.stats_daily GROUP BY m"
    )


def test_several_anchors_require_every_table() -> None:
    """A partition present in only one of the new marts must still count as dirty."""
    sql = anchor_sql("", (("decisions", "played_date"), ("player_hands", "played_date")))
    assert "marts.decisions" in sql and "marts.player_hands" in sql
    assert " UNION ALL " in sql
    assert sql.endswith("GROUP BY m HAVING count() = 2")
    assert "min(built_max)" in sql


def test_dbt_vars_carry_batch_and_anchors() -> None:
    assert dbt_vars(3, DEFAULT_ANCHORS) == "{batch_partitions: 3, anchors: [[stats_daily, day]]}"
    assert (
        dbt_vars(1, (("decisions", "played_date"), ("player_hands", "played_date")))
        == "{batch_partitions: 1, anchors: [[decisions, played_date], [player_hands, played_date]]}"
    )


def test_the_watermark_alone_is_the_gate_by_default() -> None:
    """The ordinary case: only a changed source makes a partition dirty."""
    assert dirty_where(None) == "src.src_max > built.built_max"
    assert dirty_where(0) == "src.src_max > built.built_max"


def test_rebuild_from_forces_partitions_the_watermark_calls_clean() -> None:
    """The ALTER ADD COLUMN case (F.10).

    A new column leaves every source row untouched, so the watermark says "clean" while the
    column is empty. On 2026-09-11 that left `invested_bb` at zero for both hero months, which
    no re-parse had touched, while the other eight months were correct. The override must be an
    OR: partitions that are dirty for the ordinary reason stay dirty too.
    """
    where = dirty_where(20260801)
    assert where == "(src.src_max > built.built_max OR src.m >= 20260801)"
    assert dirty_sql("", DEFAULT_ANCHORS, 20260801).count("20260801") == 1


def test_rebuild_from_reaches_the_dbt_macro_as_a_var() -> None:
    """The loop and the macro each filter; both must learn about the override."""
    assert dbt_vars(2, DEFAULT_ANCHORS, 20260801).endswith(", rebuild_from: 20260801}")
    assert "rebuild_from" not in dbt_vars(2, DEFAULT_ANCHORS)


@pytest.mark.parametrize(
    ("day", "expected"),
    [("2026-08-01", 20260801), ("2025-1-5", 20250105), ("2024-12-31", 20241231)],
)
def test_dates_become_partition_integers(day: str, expected: int) -> None:
    assert partition_of(day) == expected


@pytest.mark.parametrize("bad", ["20260801", "2026/08/01", "2026-08", "not-a-date", "26-08-01"])
def test_a_malformed_rebuild_from_is_rejected_rather_than_silently_zero(bad: str) -> None:
    """A misread date here would rebuild everything or nothing, both quietly."""
    with pytest.raises(SystemExit, match="YYYY-MM-DD"):
        partition_of(bad)
