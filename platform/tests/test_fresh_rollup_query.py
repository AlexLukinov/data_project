"""The rollup is read fresh: each (dataset, day) from exactly one of its two producers (ADR-047).

`stats/query.py: rollup_from` reads dbt's `marts.stats_daily` for the slices dbt has built and
the view's `marts.stats_daily_mv` for the slices the ingest worker has written into since --
decided by which holds the newer stamp -- so an upload is in a report seconds after it landed and
nothing is ever counted from both. These pin the SQL shape without a database; the integration
proof is `tests/integration/test_hot_path.py`.
"""

from __future__ import annotations

from typing import Any

from core.settings import get_settings
from stats.query import build_query
from stats.registry import registry
from stats.request import ReportRequest
from stats.resolve import dimensions_used, resolve_stats
from stats.router import plan

MARTS = get_settings().db("marts")
"""`marts`, or `test_marts` under `make test-all`: the assertions below name the physical table."""


def _one(request: ReportRequest, tenant_id: int = 1) -> tuple[str, dict[str, Any]]:
    """Plan and build exactly as `stats.service.run_report` does."""
    reg = registry()
    stats = resolve_stats(request, reg)
    plans = plan(stats, dimensions_used(request), reg, dispersion=request.confidence is not None)
    assert len(plans) == 1
    return build_query(request, tenant_id, plans[0], reg)


def test_the_rollup_is_a_disjoint_union_of_its_two_producers() -> None:
    """dbt's rollup for the slices dbt has built, the view's target for the slices the worker
    has written into since -- decided by which holds the newer stamp, never both."""
    sql, params = _one(ReportRequest(stats=["vpip"]), tenant_id=9)
    assert sql.startswith("WITH (SELECT groupArray((f.dataset, f.day)) FROM ")
    assert f"max(src_parsed_at) AS fresh_max FROM {MARTS}.stats_daily_mv" in sql
    assert f"max(src_parsed_at) AS built_max FROM {MARTS}.stats_daily" in sql
    assert "WHERE f.fresh_max > b.built_max) AS __dirty" in sql
    assert f"FROM {MARTS}.stats_daily AS r WHERE r.user_id = {{tenant_id:UInt32}}" in sql
    assert "AND NOT has(__dirty, (r.dataset, r.day)) UNION ALL " in sql
    assert f"FROM {MARTS}.stats_daily_mv AS f WHERE f.user_id = {{tenant_id:UInt32}}" in sql
    assert "AND has(__dirty, (f.dataset, f.day))) AS s WHERE" in sql
    assert params["tenant_id"] == 9


def test_every_branch_of_the_fresh_rollup_is_tenant_scoped() -> None:
    """Five places name the tenant: the two stamp subqueries, the two branches, the outer scope.
    All of them are the one bound parameter, so no branch can ever read across tenants."""
    sql, _ = _one(ReportRequest(stats=["vpip"]))
    assert sql.count("user_id = {tenant_id:UInt32}") == 5
    assert "stats_daily_mv" not in sql.split(") AS s WHERE", 1)[1], (
        "the view target is read inside the union only"
    )


def test_the_union_drops_the_watermark_so_both_producers_line_up_by_position() -> None:
    """The two tables share every column but the watermark's TYPE (an aggregate maximum on the
    view target); `EXCEPT` keeps the branches positionally identical."""
    sql, _ = _one(ReportRequest(stats=["vpip"]))
    assert sql.count(f"SELECT * EXCEPT (src_parsed_at) FROM {MARTS}.stats_daily") == 2


def test_fact_tables_are_read_directly_not_through_the_union() -> None:
    sql, _ = _one(ReportRequest(stats=["af_flop"]))
    assert not sql.startswith("WITH") and "stats_daily_mv" not in sql
    assert f"FROM {MARTS}.decisions AS s WHERE" in sql
