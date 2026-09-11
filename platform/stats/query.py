"""One report plan -> one parameterized ClickHouse query. **The security boundary.**

Three rules, unchanged from the v1 compiler this replaced (plan C.4):

  1. `tenant_id` is a constructor argument, never a filter field. Every query starts with
     `s.user_id = {tenant_id:UInt32}`.
  2. Every value is a bound parameter: the filter tree goes through `Compiler` with `Params`,
     the scalars (dataset, dates, player key, limit) are bound here. No caller text is ever
     concatenated into SQL.
  3. Identifiers come from the registry: a dimension code is a column only because
     `dimensions.yaml` says so, a stat code becomes an alias only after the `CODE` pattern.
"""

from __future__ import annotations

from typing import Any

from core.settings import get_settings
from stats.ast import All
from stats.compiler import COMPARISONS, Compiler, Params, quote
from stats.definitions import ROUNDING, Dimension, Format, Stat, Table
from stats.errors import RegistryError, ReportError
from stats.interval import DISPERSION_SUFFIX
from stats.registry import Registry
from stats.request import DATASET_POPULATION, CohortSpec, ReportRequest
from stats.resolve import ResolvedStat
from stats.router import ROLLUP, Plan

PHYSICAL: dict[Table, str] = {
    "stats_daily": "stats_daily",
    "player_hands": "player_hands",
    "decisions": "decisions",
}
"""Registry table -> mart table."""

DATE_COLUMN: dict[Table, str] = {
    "stats_daily": "day",
    "player_hands": "played_date",
    "decisions": "played_date",
}
PLAYER_COLUMN: dict[Table, str] = {
    "stats_daily": "player_key",
    "player_hands": "player_key_norm",
    "decisions": "player_key_norm",
}
HANDS_EXPR: dict[Table, str] = {
    "stats_daily": "sum(s.hands)",
    "player_hands": "count()",
    "decisions": "uniqCombined64(20)(s.hand_uid)",
}
"""How many hands a row covers: on the decision table, the distinct hands with a matching
decision. Counted with a 20-bit HyperLogLog there rather than exactly: exact up to ~10^5
hands (every hero report), within 0.15% on the 9M-hand pool, and 1.6 s / 16 MiB instead of
4.3 s / 864 MiB for a whole-pool situation query on the 4 GB node (measured, plan C.7)."""

HANDS_ALIAS = "__hands"


def build_query(
    request: ReportRequest, tenant_id: int, plan: Plan, reg: Registry
) -> tuple[str, dict[str, Any]]:
    """(sql, parameters) for one plan. The SQL contains no caller data, only placeholders."""
    params = Params()
    compiler = Compiler(dims=reg.dimensions, table=plan.table, values=params, alias="s")

    select: list[str] = []
    for code in request.group_by:
        select.append(f"{group_expr(_dimension(code, reg, plan.table))} AS {code}")
    wants = request.confidence is not None
    try:
        for stat in plan.stats:
            select.extend(stat_columns(stat, plan.table, compiler, dispersion=wants))
        filter_sql = compiler.node(request.filter)
    except RegistryError as exc:
        raise ReportError(str(exc)) from exc
    select.append(f"{HANDS_EXPR[plan.table]} AS {HANDS_ALIAS}")

    where, scalars = scope(request, tenant_id, plan.table)
    if not (isinstance(request.filter, All) and not request.filter.all):
        where.append(f"({filter_sql})")
    if request.cohort is not None and request.dataset == DATASET_POPULATION:
        members = cohort_subquery(request.cohort, reg, params)
        where.append(f"s.{PLAYER_COLUMN[plan.table]} IN ({members})")

    table = f"{get_settings().db('marts')}.{PHYSICAL[plan.table]}"
    sql = f"SELECT {', '.join(select)} FROM {table} AS s WHERE {' AND '.join(where)}"
    if request.group_by:
        keys = ", ".join(request.group_by)
        sql += f" GROUP BY {keys} ORDER BY {keys}"
    else:
        sql += " GROUP BY ()"
    sql += " LIMIT {limit:UInt32}"
    scalars["limit"] = request.limit
    return sql, {**scalars, **params.values}


def scope(request: ReportRequest, tenant_id: int, table: Table) -> tuple[list[str], dict[str, Any]]:
    """The WHERE terms that scope every query, and their bound values.

    Tenant first, always, and never from the caller's payload. The dataset predicate is
    unconditional for the same reason: no query may span both bodies of hands.
    """
    where = ["s.user_id = {tenant_id:UInt32}", "s.dataset = {dataset:String}"]
    scalars: dict[str, Any] = {"tenant_id": tenant_id, "dataset": request.dataset}
    if request.hero_only:
        where.append("s.is_hero = 1")
    if request.player_key is not None:
        where.append(f"s.{PLAYER_COLUMN[table]} = {{player_key:String}}")
        scalars["player_key"] = request.player_key
    if request.date_from is not None:
        where.append(f"s.{DATE_COLUMN[table]} >= {{date_from:Date}}")
        scalars["date_from"] = request.date_from
    if request.date_to is not None:
        where.append(f"s.{DATE_COLUMN[table]} <= {{date_to:Date}}")
        scalars["date_to"] = request.date_to
    return where, scalars


def cohort_subquery(spec: CohortSpec, reg: Registry, params: Params) -> str:
    """The players a cohort names: each `player_key` of the rollup that meets every rule.

    Evaluated on `stats_daily` because a cohort is defined by whole-history stats per player,
    which is exactly what the rollup sums -- so only cached stats may appear in a rule, and
    the answer is the same whatever the enclosing report filters on. Anonymized seats ('')
    are never members. The tenant and dataset placeholders are the enclosing query's own;
    every identifier is qualified with `c`, so no outer alias can capture it.
    """
    having: list[str] = []
    for rule in spec.rules:
        stat = _cached_stat(rule.stat, reg)
        if stat.denominator_expr is None:
            numerator, denominator = f"sum(c.{stat.code})", None
        else:
            numerator, denominator = f"sum(c.{stat.code}_action)", f"sum(c.{stat.code}_opp)"
        bound = params.scalar(rule.value, "Float64")
        value = value_expr(numerator, denominator, stat.format)
        having.append(f"{value} {COMPARISONS[rule.op]} {bound}")
    table = f"{get_settings().db('marts')}.{PHYSICAL[ROLLUP]}"
    return (
        f"SELECT c.player_key FROM {table} AS c WHERE c.user_id = {{tenant_id:UInt32}}"
        " AND c.dataset = {dataset:String} AND c.player_key != '' GROUP BY c.player_key"
        f" HAVING {' AND '.join(having)}"
    )


def _cached_stat(code: str, reg: Registry) -> Stat:
    try:
        stat = reg.stat(code)
    except RegistryError as exc:
        raise ReportError(f"cohort rule: {exc}") from exc
    if not stat.cached:
        raise ReportError(f"cohort rule on {code!r}: only cached stats can define a cohort")
    return stat


def _dimension(code: str, reg: Registry, table: Table) -> Dimension:
    dim = reg.dimensions.get(code)
    if dim is None or table not in dim.tables:
        raise ReportError(f"cannot group by {code!r} on {table!r}")
    if not dim.group_by:
        raise ReportError(f"{code!r} is not a group-by dimension")
    return dim


def group_expr(dim: Dimension) -> str:
    """The column itself, or its presentation buckets for a number dimension that has them."""
    if not dim.buckets:
        return f"s.{dim.code}"
    ordered = sorted(dim.buckets.items(), key=lambda item: (item[1][0] is not None, item[1][0]))
    branches: list[str] = []
    fallback = "'other'"
    for name, (_, high) in ordered:
        if high is None:
            fallback = quote(name)
        else:
            branches.append(f"s.{dim.code} < {_number(high)}, {quote(name)}")
    return "multiIf(" + ", ".join([*branches, fallback]) + ")"


def _number(value: float) -> str:
    """`1` rather than `1.0` for a whole bucket edge; the SQL reads like the registry."""
    return str(int(value)) if value == int(value) else repr(value)


def stat_columns(
    stat: ResolvedStat, table: Table, compiler: Compiler, *, dispersion: bool = False
) -> list[str]:
    """`<value> AS code, <n> AS code__n`: the sample size travels with every stat, always.

    With `dispersion`, a per-100 stat gains a third column, `stddevSamp(x) AS code__sd`: the
    per-row spread its confidence interval is computed from (plan E.2). Nothing else gains a
    column -- a proportion's interval needs only the value and `n`.
    """
    if table == ROLLUP:
        numerator = f"sum(s.{stat.code}_action)" if stat.denominator else f"sum(s.{stat.code})"
        denominator = f"sum(s.{stat.code}_opp)" if stat.denominator else None
    else:
        numerator = compiler.expr(stat.numerator)
        denominator = compiler.expr(stat.denominator) if stat.denominator else None
    columns = [
        f"{value_expr(numerator, denominator, stat.format)} AS {stat.code}",
        f"{denominator or numerator} AS {stat.code}__n",
    ]
    spread = stat.dispersion if dispersion and table != ROLLUP else None
    if spread is not None:
        # `compiler.expr(stat.numerator)` above already refused a column this table does not
        # have, so the identifier below is the registry's and never the caller's (rule 3).
        columns.append(f"stddevSamp({compiler.column(spread)}) AS {stat.code}{DISPERSION_SUFFIX}")
    return columns


def value_expr(numerator: str, denominator: str | None, fmt: Format) -> str:
    """The stat's value in its format; `nullIf` so an empty denominator is NULL, not nan."""
    if denominator is None:
        return numerator
    scale = "" if fmt == "ratio" else "100 * "
    return f"round({scale}{numerator} / nullIf({denominator}, 0), {ROUNDING[fmt]})"
