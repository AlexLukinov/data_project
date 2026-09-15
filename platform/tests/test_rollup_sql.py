"""The dbt model and the materialized view are the same SELECT (ADR-003, ADR-044).

`tests/test_gen_stats.py` checks that the generated rollup follows the registry. These check the
property that lets a second producer exist at all: that the view is not a copy of the model but
the same rendered body, and that nothing about the view can quietly write into the dbt anchor.

The reconciliation against a real database is `tests/integration/test_mv_reconciliation.py`;
these run without one, so a drift introduced in the generator is caught by `make check` rather
than only by the integration suite.
"""

from __future__ import annotations

import re

from scripts.rollup_sql import (
    BOUNDARY,
    DBT_PROVENANCE,
    KEYS,
    MV_MIGRATION,
    MV_TARGET,
    MV_WATERMARK_TYPE,
    ROLLUP,
    WATERMARK,
    _branch,
    mv_target_column_types,
    render_mv_migration,
    render_mv_views,
    rollup_column_types,
    select_body,
)
from stats.definitions import Table
from stats.registry import registry

SOURCES: tuple[Table, ...] = ("decisions", "player_hands")


def _select_lines(sql: str) -> list[str]:
    """The SELECT list of a statement, normalised to bare lines."""
    body = sql.split("\nfrom ", 1)[0]
    return [line.strip().rstrip(",") for line in body.splitlines() if line.startswith("    ")]


def test_the_view_and_the_model_select_the_same_columns() -> None:
    """The no-drift guarantee, stated as a test.

    If this ever fails, the two producers of `marts.stats_daily` have come apart and the
    reconciliation test is the only thing standing between that and wrong numbers on screen.
    """
    reg = registry()
    views = render_mv_views(reg)
    for source in SOURCES:
        view = views.split(f"CREATE MATERIALIZED VIEW marts.{MV_TARGET}_{source}")[1]
        assert _select_lines(view) == _select_lines(_branch(reg, source, source)), (
            f"the {source} view and the dbt model no longer select the same columns"
        )


def test_the_view_targets_its_own_table_not_the_dbt_anchor() -> None:
    """A view writing into `marts.stats_daily` makes the incremental gate compare a value to
    itself, so the day reads clean for ever and the fact tables are never built for it."""
    views = render_mv_views(registry())
    assert f"TO marts.{MV_TARGET}" in views
    assert re.search(rf"TO marts\.{ROLLUP}\b(?!_mv)", views) is None, (
        "a materialized view points at the dbt anchor"
    )


def test_every_view_is_fenced_by_its_boundary() -> None:
    """A materialized view is forward-only, so each one must filter on its recorded boundary --
    otherwise the backfill below the boundary and the view above it would overlap."""
    views = render_mv_views(registry())
    for source in SOURCES:
        fence = f"where fact.src_parsed_at >= (select boundary_at from _meta.{BOUNDARY} final"
        assert fence in views
        assert f"'{MV_TARGET}_{source}'" in views


def test_the_views_are_dropped_before_they_are_created() -> None:
    """The file is re-applied whenever the registry changes; `IF NOT EXISTS` would silently
    keep the old definition, which is exactly the drift this step exists to prevent."""
    views = render_mv_views(registry())
    for source in SOURCES:
        name = f"marts.{MV_TARGET}_{source}"
        assert views.index(f"DROP VIEW IF EXISTS {name};") < views.index(
            f"CREATE MATERIALIZED VIEW {name} "
        )


def test_the_target_table_has_a_column_per_rollup_column() -> None:
    """The migration creates the target by hand -- it cannot infer types from a SELECT, because
    `marts.decisions` does not exist when migrations run -- so the column list must match."""
    reg = registry()
    migration = render_mv_migration(reg)
    columns = mv_target_column_types(reg)
    assert len(columns) == len(_select_lines(_branch(reg, "decisions", "decisions")))
    assert [n for n, _ in columns] == [n for n, _ in rollup_column_types(reg)]
    for name, ch_type in columns:
        assert f"    {name} {ch_type}" in migration, f"{name} missing from the target table"


def test_the_target_watermark_is_an_aggregate_maximum() -> None:
    """A plain DateTime64 in a SummingMergeTree keeps whichever row a merge saw first (ADR-044
    measured it); the read path compares this column with the dbt rollup's to decide which
    slices the view serves, so it must be the maximum whatever the merge state (ADR-047)."""
    reg = registry()
    assert dict(mv_target_column_types(reg))[WATERMARK] == MV_WATERMARK_TYPE
    assert MV_WATERMARK_TYPE.startswith("SimpleAggregateFunction(max, ")
    assert dict(rollup_column_types(reg))[WATERMARK] != MV_WATERMARK_TYPE, "dbt's stays plain"


def test_the_migration_drops_the_views_and_the_old_target_before_creating() -> None:
    """0011's target had the plain type; the runner is append-only, so 0012 replaces it. The
    views go first: a view whose target is gone fails every insert into its source."""
    migration = render_mv_migration(registry())
    assert MV_MIGRATION == "0012_mv_stats_daily_v2"
    order = [
        migration.index(f"DROP VIEW IF EXISTS marts.{MV_TARGET}_decisions;"),
        migration.index(f"DROP VIEW IF EXISTS marts.{MV_TARGET}_player_hands;"),
        migration.index(f"DROP TABLE IF EXISTS marts.{MV_TARGET};"),
        migration.index(f"CREATE TABLE IF NOT EXISTS marts.{MV_TARGET} ("),
    ]
    assert order == sorted(order)


def test_the_model_aggregates_dbt_rows_only_and_the_view_aggregates_everything() -> None:
    """The other half of the race guard: rows the worker derived reach the rollup through the
    view alone, so dbt's watermark for a day never says more than dbt itself derived."""
    reg = registry()
    for source in SOURCES:
        assert f"and built_by = '{DBT_PROVENANCE}'" in _branch(reg, source, source)
    assert "built_by" not in render_mv_views(reg)


def test_the_target_orders_by_every_group_key() -> None:
    """SummingMergeTree collapses rows sharing the sort key, so a group key outside it would
    add two different groups together (docs/POKER_AUDIT.md B5)."""
    migration = render_mv_migration(registry())
    order_by = migration.split("ORDER BY (")[1].split(")")[0]
    assert [k.strip() for k in order_by.split(",")] == [target for _, target, _ in KEYS]


def test_the_migration_creates_nothing_that_depends_on_dbt() -> None:
    """`api/provision.py` migrates BEFORE dbt builds the marts, so a migration naming
    `marts.decisions` would fail on every fresh environment."""
    migration = render_mv_migration(registry())
    for table in SOURCES:
        assert f"marts.{table}" not in migration


def test_the_select_body_is_rendered_once_per_table() -> None:
    """Both callers pass through one renderer; a table it does not know is a hard error."""
    reg = registry()
    for source in SOURCES:
        assert select_body(reg, source).startswith("select\n")
