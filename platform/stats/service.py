"""`run_report`: a request in, rows of `{value, n}` cells out (POKER_PLAN.md §2.6).

    result = run_report(request, tenant_id=user.tenant_id)

Resolves the stats, asks the router for one or two plans, runs one parameterized query per
plan, merges the rows on the group key, optionally attaches a population baseline to every
cell, and caches the answer under the tenant's namespace. The database client and the cache
are injectable so every step is unit-tested without either.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol

from ingestion.clickhouse import clickhouse
from stats.query import HANDS_ALIAS, build_query
from stats.registry import Registry, registry
from stats.request import Cell, ReportRequest, ReportResult, ReportRow, StatMeta
from stats.resolve import ResolvedStat, dimensions_used, resolve_stats
from stats.router import plan

Rows = tuple[list[str], Sequence[Sequence[Any]]]
Runner = Callable[[str, Mapping[str, Any]], Rows]
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
    """Run one query on the process-wide client."""
    result = clickhouse().query(sql, parameters=dict(params))
    return list(result.column_names), result.result_rows


def run_report(
    request: ReportRequest,
    tenant_id: int,
    *,
    run: Runner = clickhouse_runner,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> ReportResult:
    """Answer a report for one tenant. `tenant_id` comes from the token, never the request."""
    reg = reg or registry()
    key = request.cache_key(tenant_id)
    if cache is not None:
        hit = cache.get_json(key)
        if hit is not None:
            return ReportResult.model_validate(hit).model_copy(update={"cached": True})

    stats = resolve_stats(request, reg)
    plans = plan(stats, dimensions_used(request), reg)
    merged: dict[GroupKey, ReportRow] = {}
    for one in plans:
        columns, rows = run(*build_query(request, tenant_id, one, reg))
        _merge(merged, request.group_by, one.stats, columns, rows)

    result = ReportResult(
        hands=sum(row.hands for row in merged.values()) if request.group_by else _total(merged),
        group_by=list(request.group_by),
        stats=[_meta(s) for s in stats],
        rows=list(merged.values()),
    )
    if request.compare_to == "population":
        result = _with_baseline(result, request, tenant_id, run=run, reg=reg)
    if cache is not None:
        cache.set_json(key, result.model_dump(mode="json"))
    return result


def _merge(
    merged: dict[GroupKey, ReportRow],
    group_by: Sequence[str],
    stats: Sequence[ResolvedStat],
    columns: Sequence[str],
    rows: Sequence[Sequence[Any]],
) -> None:
    """Fold one query's rows into the result, keyed by the group values."""
    for raw in rows:
        record = dict(zip(columns, raw, strict=True))
        key = tuple(record[code] for code in group_by)
        cells = {
            stat.code: Cell(
                value=_float(record.get(stat.code)), n=int(record.get(f"{stat.code}__n") or 0)
            )
            for stat in stats
        }
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
