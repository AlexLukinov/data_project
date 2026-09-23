"""One clustered report plan -> one two-level ClickHouse query (ADR-076, plan G.3).

The flat query (`stats.query.build_query`) aggregates rows straight into groups. A clustered
one aggregates **per player first**, then sums the per-player results into the groups, and
carries beside every stat the sums of squares its cluster-robust interval needs
(`stats.cluster`). Nothing about a player ever leaves the database: the inner level is a
subquery, and the outer level returns the same one row per group the flat query does, with
five more columns per stat.

    SELECT <group buckets>, <stat = summed numerator / summed denominator>, <cluster sums>, ...
    FROM (SELECT <bucketed group columns>, <player>, <per-player numerator and denominator>
          FROM <fact table> AS s WHERE <tenant, dataset, filter, cohort>
          GROUP BY <bucketed group columns>, <player>) AS s
    GROUP BY <group buckets> ORDER BY ... LIMIT ...

A stat must **add up over players** for the outer sums to reproduce the flat value: a count, a
sum, and sums and differences of those. A product or a quotient inside the expression does
not -- the sum of per-player ratios is not the ratio of the sums -- so such a custom stat is
refused by name rather than answered with a number that is quietly wrong.

The inner level groups by the **bucketed** group columns -- the same `group_expr` the flat
query selects -- and the player, so a player whose rows fall in two raw values of one bucket
is one cluster in that bucket, not two; the outer level groups by the bucket names alone.
Scope, filter and cohort are the same WHERE terms (`stats.query.where_terms`), the values the
same bound parameters (rule 2 of the flat builder), the identifiers the same registry codes
(rule 3), and `order_by` compiles against the same aliases. Only the fact tables are read:
the router never plans a clustered report on the rollup.
"""

from __future__ import annotations

from typing import Any

from stats.ast import Arithmetic, Div, Expr, Mul, operands
from stats.cluster import (
    CROSS_SUFFIX,
    NUMERATOR_SUFFIX,
    PLAYERS_SUFFIX,
    SIZES_SUFFIX,
    SQUARES_SUFFIX,
)
from stats.compiler import Compiler, Params
from stats.definitions import Table
from stats.errors import RegistryError, ReportError
from stats.order import order_by
from stats.query import (
    HANDS_ALIAS,
    PLAYER_COLUMN,
    _dimension,
    group_expr,
    source_of,
    value_expr,
    where_terms,
)
from stats.registry import Registry
from stats.request import ReportRequest
from stats.resolve import ResolvedStat
from stats.router import ROLLUP, Plan

PLAYER_ALIAS = "__player"
"""The inner level's player column. Two underscores, so no registry code can be it."""

HANDS_STATE: dict[Table, tuple[str, str]] = {
    "player_hands": ("count()", f"sum(s.{HANDS_ALIAS})"),
    "decisions": (
        "uniqCombined64State(20)(s.hand_uid)",
        f"uniqCombined64Merge(20)(s.{HANDS_ALIAS})",
    ),
}
"""How many hands a group covers, in two halves: the per-player state and its merge. The
HyperLogLog of `stats.query.HANDS_EXPR` is kept as a partial state per player and merged
above, so the count is the same estimate the flat query makes; a row count simply adds."""

CLUSTERED_FORMATS = frozenset({"percent", "per100"})
"""The formats whose interval is cluster-robust. A ratio and a count carry no interval at all
(`stats.interval`), so they carry no cluster sums either."""


def build_clustered(
    request: ReportRequest, tenant_id: int, plan: Plan, reg: Registry
) -> tuple[str, dict[str, Any]]:
    """(sql, parameters) for one plan, clustered by player. No caller data in the SQL."""
    if plan.table == ROLLUP:
        raise ReportError("a clustered report reads the fact tables, never the rollup")
    params = Params()
    compiler = Compiler(dims=reg.dimensions, table=plan.table, values=params, alias="s")
    dims = [_dimension(code, reg, plan.table) for code in request.group_by]
    inner = [f"{group_expr(d)} AS {d.code}" for d in dims]
    inner.append(f"s.{PLAYER_COLUMN[plan.table]} AS {PLAYER_ALIAS}")
    outer = [f"s.{d.code} AS {d.code}" for d in dims]
    try:
        for stat in plan.stats:
            per_player, summed = clustered_columns(stat, compiler)
            inner.extend(per_player)
            outer.extend(summed)
        filter_sql = compiler.node(request.filter)
        ranking = order_by(request, plan, compiler, reg)
    except RegistryError as exc:
        raise ReportError(str(exc)) from exc
    state, merge = HANDS_STATE[plan.table]
    inner.append(f"{state} AS {HANDS_ALIAS}")
    outer.append(f"{merge} AS {HANDS_ALIAS}")

    where, scalars = where_terms(request, tenant_id, plan.table, filter_sql, params, reg)
    scalars["limit"] = request.limit
    sql = _assemble(request, plan.table, inner, outer, where, ranking)
    return sql, {**scalars, **params.values}


def _assemble(
    request: ReportRequest,
    table: Table,
    inner: list[str],
    outer: list[str],
    where: list[str],
    ranking: str,
) -> str:
    """The two levels as one statement: the per-player subquery, the sums over it."""
    _, source = source_of(table)
    per_player_keys = ", ".join([*request.group_by, PLAYER_ALIAS])
    by_player = (
        f"SELECT {', '.join(inner)} FROM {source} AS s WHERE {' AND '.join(where)}"
        f" GROUP BY {per_player_keys}"
    )
    sql = f"SELECT {', '.join(outer)} FROM ({by_player}) AS s"
    if request.group_by:
        keys = ", ".join(request.group_by)
        sql += f" GROUP BY {keys} ORDER BY {ranking or keys}"
    else:
        sql += " GROUP BY ()"
    return sql + " LIMIT {limit:UInt32}"


def adds_up(expr: Expr) -> bool:
    """Whether summing an expression's per-player values gives its value over all rows.

    True for a count, a sum, and sums and differences of those; false as soon as a product
    or a quotient appears anywhere in the tree.
    """
    if isinstance(expr, Mul | Div):
        return False
    if isinstance(expr, Arithmetic):
        return all(adds_up(child) for child in operands(expr)[1])
    return True


def clustered_columns(stat: ResolvedStat, compiler: Compiler) -> tuple[list[str], list[str]]:
    """One stat's columns in two halves: per player (inner), and summed over players (outer).

    The outer half reproduces the flat builder's `<value> AS code, <n> AS code__n` from the
    per-player sums, then adds the numerator sum, the players with an opportunity and the
    three sums of squares -- for the formats that have an interval to compute.
    """
    if not (adds_up(stat.numerator) and (stat.denominator is None or adds_up(stat.denominator))):
        raise ReportError(
            f"{stat.code!r}: a clustered report needs a stat that adds up over players "
            "(counts, sums, and sums or differences of them -- no mul or div)"
        )
    numerator, denominator = f"{stat.code}{NUMERATOR_SUFFIX}", f"{stat.code}__n"
    per_player = [f"{compiler.expr(stat.numerator)} AS {numerator}"]
    if stat.denominator is not None:
        per_player.append(f"{compiler.expr(stat.denominator)} AS {denominator}")
    total_x = f"sum(s.{numerator})"
    total_n = f"sum(s.{denominator})" if stat.denominator is not None else None
    summed = [
        f"{value_expr(total_x, total_n, stat.format)} AS {stat.code}",
        f"{total_n or total_x} AS {denominator}",
    ]
    if stat.format in CLUSTERED_FORMATS and total_n is not None:
        summed.extend(
            [
                f"{total_x} AS {numerator}",
                f"countIf(s.{denominator} > 0) AS {stat.code}{PLAYERS_SUFFIX}",
                f"sum(s.{numerator} * s.{numerator}) AS {stat.code}{SQUARES_SUFFIX}",
                f"sum(s.{numerator} * s.{denominator}) AS {stat.code}{CROSS_SUFFIX}",
                f"sum(s.{denominator} * s.{denominator}) AS {stat.code}{SIZES_SUFFIX}",
            ]
        )
    return per_player, summed
