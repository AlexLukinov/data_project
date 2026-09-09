"""The migration runner applies the database prefix to append-only migration files."""

from __future__ import annotations

from ch.migrate import DATABASES, prefixed

SAMPLE = """
CREATE DATABASE IF NOT EXISTS core;
CREATE TABLE IF NOT EXISTS core.hands (user_id UInt32, core_score UInt8) ENGINE = MergeTree
ORDER BY user_id;
CREATE VIEW IF NOT EXISTS core.v_format_drift AS SELECT site FROM core.hands FINAL;
CREATE DATABASE IF NOT EXISTS marts;
CREATE TABLE IF NOT EXISTS marts.baseline_strategies (x UInt8) ENGINE = MergeTree ORDER BY x;
"""


def test_no_prefix_leaves_sql_untouched() -> None:
    assert prefixed(SAMPLE, "") == SAMPLE


def test_prefix_applies_to_qualifiers_and_create_database() -> None:
    out = prefixed(SAMPLE, "test_")
    assert "CREATE DATABASE IF NOT EXISTS test_core;" in out
    assert "CREATE DATABASE IF NOT EXISTS test_marts;" in out
    assert "test_core.hands" in out and "test_core.v_format_drift" in out
    assert "test_marts.baseline_strategies" in out
    assert "core.hands FINAL" not in out.replace("test_core.hands", "")


def test_prefix_does_not_touch_columns_that_merely_contain_a_database_name() -> None:
    out = prefixed(SAMPLE, "test_")
    assert "core_score UInt8" in out, "a column named core_score is not a database qualifier"


def test_every_known_database_is_covered() -> None:
    for name in DATABASES:
        assert prefixed(f"SELECT 1 FROM {name}.t", "p_") == f"SELECT 1 FROM p_{name}.t"
