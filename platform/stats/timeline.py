"""The winnings series: one row per day, for the graph.

Not a report -- the group key is time, and the measures are the four money sums -- but it is
scoped exactly like one (`stats.query.scope`) and routed the same way: the rollup when every
dimension the filter names is coarse, else `player_hands` (money is hand-grain). The four
columns are the rollup's `<code>_action` sums of the money stats in the registry.
"""

from __future__ import annotations

from typing import Any

from stats.ast import All
from stats.compiler import Compiler, Params
from stats.definitions import Table
from stats.errors import RegistryError, ReportError
from stats.query import DATE_COLUMN, scope, source_of
from stats.registry import Registry
from stats.request import ReportRequest
from stats.resolve import dimensions_used
from stats.router import ROLLUP

MONEY_CODES = ("bb_per_100", "ev_bb_per_100", "sd_bb_per_100", "nsd_bb_per_100")
"""The registry stats whose rollup sums are the series: net, all-in adjusted, showdown,
non-showdown, in that order."""

FACT_COLUMNS = ("net_won_bb", "ev_won_bb", "showdown_won_bb", "nonshowdown_won_bb")
ALIASES = ("won_bb", "ev_bb", "sd_bb", "nsd_bb")


def build_timeline(
    request: ReportRequest, tenant_id: int, reg: Registry
) -> tuple[str, dict[str, Any]]:
    """(sql, parameters): `day, hands, won_bb, ev_bb, sd_bb, nsd_bb` in date order."""
    table = _table(request, reg)
    params = Params()
    compiler = Compiler(dims=reg.dimensions, table=table, values=params, alias="s")
    where, scalars = scope(request, tenant_id, table)
    if not (isinstance(request.filter, All) and not request.filter.all):
        try:
            where.append(f"({compiler.node(request.filter)})")
        except RegistryError as exc:
            raise ReportError(str(exc)) from exc

    if table == ROLLUP:
        measures = ["sum(s.hands) AS hands"] + [
            f"sum(s.{code}_action) AS {alias}"
            for code, alias in zip(MONEY_CODES, ALIASES, strict=True)
        ]
    else:
        measures = ["count() AS hands"] + [
            f"sum(s.{column}) AS {alias}"
            for column, alias in zip(FACT_COLUMNS, ALIASES, strict=True)
        ]
    prologue, physical = source_of(table)
    sql = (
        f"{prologue}SELECT s.{DATE_COLUMN[table]} AS day, {', '.join(measures)} "
        f"FROM {physical} AS s WHERE {' AND '.join(where)} GROUP BY day ORDER BY day"
    )
    return sql, {**scalars, **params.values}


def _table(request: ReportRequest, reg: Registry) -> Table:
    """The rollup unless a filter dimension lives only on the facts."""
    for code in dimensions_used(request):
        try:
            dim = reg.dimension(code)
        except RegistryError as exc:
            raise ReportError(f"unknown dimension {code!r}") from exc
        if ROLLUP not in dim.tables:
            if "player_hands" not in dim.tables:
                raise ReportError(f"dimension {code!r} is not available on the winnings series")
            return "player_hands"
    return ROLLUP
