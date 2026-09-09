"""The backfill loop and the dbt macro must agree on what "built" means.

`scripts/backfill.py` decides which partitions are dirty with its own SQL, and
`macros/incremental.sql` decides the same inside every model. They drifted once (monthly vs
daily) and the loop stopped early believing it was done. These tests pin the script's half:
the anchor list, its SQL, and the vars handed to dbt.
"""

from __future__ import annotations

import pytest

from scripts.anchors import DEFAULT_ANCHORS, anchor_sql, dbt_vars, parse_anchors


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
