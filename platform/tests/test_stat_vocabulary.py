"""The stat vocabulary must agree across the three places it is spelled out.

Until the registry of POKER_PLAN.md phase C makes these generated, `api/queries.py` (what the
API can ask for), `marts/stats_daily.sql` (what the rollup can answer) and
`int_hand_player_flags.sql` (what is actually computed) are maintained by hand. They drifted
once: 29 counters existed on the flag table and nowhere else, so the leak stats built on them
were unreachable from the product (docs/POKER_AUDIT.md B3/B4). These tests fail the build the
moment that happens again.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.queries import COUNTERS, STATS

DBT_MODELS = Path(__file__).resolve().parents[1] / "dbt" / "poker_dwh" / "models"
ROLLUP_SQL = DBT_MODELS / "marts" / "stats_daily.sql"
FLAGS_SQL = DBT_MODELS / "intermediate" / "int_hand_player_flags.sql"
DEFINITIONS_SQL = DBT_MODELS / "marts" / "dim_stat_definitions.sql"

_ALIAS = re.compile(r"\bas\s+([a-z][a-z0-9_]*)\s*,?\s*$", re.MULTILINE)


def _aliases(path: Path) -> set[str]:
    """Every `... as name` output column of a dbt model, read from its SQL text."""
    return set(_ALIAS.findall(path.read_text()))


@pytest.fixture(scope="module")
def rollup_columns() -> set[str]:
    return _aliases(ROLLUP_SQL)


@pytest.fixture(scope="module")
def flag_columns() -> set[str]:
    return _aliases(FLAGS_SQL)


def test_every_counter_is_computed_on_the_flag_table(flag_columns: set[str]) -> None:
    missing = sorted(name for name in COUNTERS if name not in flag_columns)
    assert not missing, f"COUNTERS not produced by int_hand_player_flags: {missing}"


def test_every_counter_is_rolled_up(rollup_columns: set[str]) -> None:
    """`_source_for` routes coarse queries to the rollup, so every counter must be there."""
    missing = sorted(name for name in COUNTERS if name not in rollup_columns)
    assert not missing, f"COUNTERS missing from stats_daily: {missing}"


def test_every_builtin_stat_uses_known_counters() -> None:
    for code, stat in STATS.items():
        assert stat.numerator in COUNTERS, f"{code}: numerator {stat.numerator!r}"
        assert stat.denominator in COUNTERS, f"{code}: denominator {stat.denominator!r}"


def test_every_opportunity_counter_on_the_flag_table_is_exposed(flag_columns: set[str]) -> None:
    """A `*_opp` column nobody can query is a stat that was paid for and never delivered."""
    stranded = sorted(c for c in flag_columns if c.endswith("_opp") and c not in COUNTERS)
    assert not stranded, f"opportunity counters on the flag table but not in COUNTERS: {stranded}"


def test_every_builtin_stat_has_a_definition_row() -> None:
    codes = set(
        re.findall(
            r"select '([a-z0-9_]+)'\s+as code|union all select '([a-z0-9_]+)'",
            DEFINITIONS_SQL.read_text(),
        )
    )
    defined = {a or b for a, b in codes}
    missing = sorted(code for code in STATS if code not in defined)
    assert not missing, f"stats without a dim_stat_definitions row: {missing}"
