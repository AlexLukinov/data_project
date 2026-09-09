"""The declared schema (core/schema) and the migrated tables (ch/migrations) must agree.

Both directions: a column in the spec that the migrations never created would make every
insert fail; a column the migrations created that the spec does not name would never be
written -- which is exactly how three columns sat empty for weeks (docs/POKER_AUDIT.md B11).
"""

from __future__ import annotations

import re

import pytest

from core.schema import TABLES, TableSpec
from core.settings import get_settings
from ingestion.clickhouse import clickhouse

pytestmark = pytest.mark.integration

_WS = re.compile(r"\s+")


def _norm(ch_type: str) -> str:
    """Whitespace-insensitive type comparison (`Decimal(18,4)` == `Decimal(18, 4)`)."""
    return _WS.sub("", ch_type)


@pytest.mark.parametrize("spec", TABLES, ids=[t.name for t in TABLES])
def test_spec_matches_system_columns(spec: TableSpec) -> None:
    rows = (
        clickhouse()
        .query(
            "SELECT name, type FROM system.columns WHERE database = {db:String} "
            "AND table = {table:String} ORDER BY position",
            parameters={"db": get_settings().db("core"), "table": spec.name},
        )
        .result_rows
    )
    actual = {name: _norm(ch_type) for name, ch_type in rows}
    declared = {name: _norm(ch_type) for name, ch_type in spec.types().items()}

    assert set(actual) == set(declared), (
        f"{spec.name}: only in ClickHouse {sorted(set(actual) - set(declared))}, "
        f"only in spec {sorted(set(declared) - set(actual))}"
    )
    mismatched = {n: (declared[n], actual[n]) for n in declared if declared[n] != actual[n]}
    assert not mismatched, f"{spec.name}: type mismatches (spec, db): {mismatched}"
