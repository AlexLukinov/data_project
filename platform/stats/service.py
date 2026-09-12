"""`run_report`: a request in, rows of `{value, n}` cells out (POKER_PLAN.md §2.6).

    result = run_report(request, tenant_id=user.tenant_id)

Resolves the stats, asks the router for one or two plans, runs one parameterized query per
plan, merges the rows on the group key, optionally attaches a population baseline to every
cell, and caches the answer under the tenant's namespace. The database client and the cache
are injectable so every step is unit-tested without either.

**The default runner is the tenant's own connection**, not the process-wide admin one
(`stats/tenancy.py`, plan E.3): the query's cost ceiling is then a ClickHouse settings profile
and quota belonging to that tenant, so an over-budget report is refused by the server. Passing
`run=` still bypasses all of it, which is what every unit test does.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from ingestion.clickhouse import clickhouse
from stats import tenancy
from stats.interval import DISPERSION_SUFFIX, Level, for_cell
from stats.query import HANDS_ALIAS, build_query
from stats.registry import Registry, registry
from stats.request import Cell, ReportRequest, ReportResult, ReportRow, StatMeta
from stats.resolve import ResolvedStat, dimensions_used, resolve_stats
from stats.router import plan
from stats.tenancy import Rows as Rows
from stats.tenancy import Runner as Runner

GroupKey = tuple[Any, ...]


class Cache(Protocol):
    """The two calls the service makes on a cache. `api.cache` satisfies it."""

    def get_json(self, key: str) -> Any | None:
        """A cached value, or None."""
        ...

    def set_json(self, key: str, value: Any) -> None:
        """Store a value."""
        ...


def clickhouse_runner(sql: str, params: Mapping[str, Any]) -> Rows:
    """Run one query on the process-wide admin client, under no tenant budget.

    Kept for the paths that are not a tenant's report -- schema probes and the migration runner --
    and as the fallback inside `tenancy.client_for`. A report uses `tenancy.runner_for`.
    """
    result = clickhouse().query(sql, parameters=dict(params))
    return list(result.column_names), result.result_rows


def validate_request(request: ReportRequest, reg: Registry | None = None) -> None:
    """Everything short of running it: stats resolve, the plan holds, every query builds.

    What a saved report is checked against before it is stored, so a report that cannot run
    is never saved. Raises `ReportError` with the caller's mistake named.
    """
    reg = reg or registry()
    stats = resolve_stats(request, reg)
    wants = request.confidence is not None
    for one in plan(stats, dimensions_used(request), reg, dispersion=wants):
        build_query(request, 0, one, reg)


def run_report(
    request: ReportRequest,
    tenant_id: int,
    *,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> ReportResult:
    """Answer a report for one tenant. `tenant_id` comes from the token, never the request."""
    reg = reg or registry()
    runner = run or tenancy.runner_for(tenant_id)
    key = request.cache_key(tenant_id)
    if cache is not None:
        hit = cache.get_json(key)
        if hit is not None:
            return ReportResult.model_validate(hit).model_copy(update={"cached": True})

    stats = resolve_stats(request, reg)
    plans = plan(stats, dimensions_used(request), reg, dispersion=request.confidence is not None)
    merged: dict[GroupKey, ReportRow] = {}
    for one in plans:
        columns, rows = runner(*build_query(request, tenant_id, one, reg))
        _merge(merged, request.group_by, one.stats, columns, rows, request.confidence)

    result = ReportResult(
        hands=sum(row.hands for row in merged.values()) if request.group_by else _total(merged),
        group_by=list(request.group_by),
        stats=[_meta(s) for s in stats],
        rows=list(merged.values()),
    )
    if request.compare_to == "population":
        result = _with_baseline(result, request, tenant_id, run=runner, reg=reg)
    if cache is not None:
        cache.set_json(key, result.model_dump(mode="json"))
    return result


def _merge(
    merged: dict[GroupKey, ReportRow],
    group_by: Sequence[str],
    stats: Sequence[ResolvedStat],
    columns: Sequence[str],
    rows: Sequence[Sequence[Any]],
    level: Level | None = None,
) -> None:
    """Fold one query's rows into the result, keyed by the group values."""
    for raw in rows:
        record = dict(zip(columns, raw, strict=True))
        key = tuple(record[code] for code in group_by)
        cells = {stat.code: _cell(stat, record, level) for stat in stats}
        existing = merged.get(key)
        if existing is None:
            merged[key] = ReportRow(
                group={code: record[code] for code in group_by},
                hands=int(record.get(HANDS_ALIAS) or 0),
                cells=cells,
            )
        else:
            merged[key] = existing.model_copy(
                update={
                    "cells": {**existing.cells, **cells},
                    "hands": max(existing.hands, int(record.get(HANDS_ALIAS) or 0)),
                }
            )


def _cell(stat: ResolvedStat, record: Mapping[str, Any], level: Level | None) -> Cell:
    """One stat in one row: its value, the sample size behind it, and the interval if asked.

    `__sd` is absent for every stat but a per-100 one, and absent for all of them when no
    level was requested; `for_cell` turns a missing spread into no interval rather than a
    guess at one.
    """
    value = _float(record.get(stat.code))
    n = int(record.get(f"{stat.code}__n") or 0)
    if level is None:
        return Cell(value=value, n=n)
    spread = _float(record.get(f"{stat.code}{DISPERSION_SUFFIX}"))
    return Cell(value=value, n=n, interval=for_cell(stat.format, value, n, spread, level))


def _total(merged: Mapping[GroupKey, ReportRow]) -> int:
    row = merged.get(())
    return row.hands if row is not None else 0


def _float(value: Any) -> float | None:
    return None if value is None else float(value)


def _meta(stat: ResolvedStat) -> StatMeta:
    return StatMeta(
        code=stat.code,
        label=stat.label,
        format=stat.format,
        grain=stat.grain,
        description=stat.description,
    )


def _with_baseline(
    result: ReportResult, request: ReportRequest, tenant_id: int, *, run: Runner, reg: Registry
) -> ReportResult:
    """The same question asked of the pool, attached cell by cell as baseline and delta."""
    baseline = run_report(request.baseline(), tenant_id, run=run, reg=reg)
    by_key = {tuple(row.group[c] for c in request.group_by): row for row in baseline.rows}
    rows: list[ReportRow] = []
    for row in result.rows:
        pool = by_key.get(tuple(row.group[c] for c in request.group_by))
        cells = {
            code: _compared(cell, pool.cells.get(code) if pool else None)
            for code, cell in row.cells.items()
        }
        rows.append(row.model_copy(update={"cells": cells}))
    return result.model_copy(update={"rows": rows})


def _compared(cell: Cell, pool: Cell | None) -> Cell:
    if pool is None or pool.value is None:
        return cell
    delta = None if cell.value is None else round(cell.value - pool.value, 3)
    return cell.model_copy(update={"baseline": pool.value, "baseline_n": pool.n, "delta": delta})
