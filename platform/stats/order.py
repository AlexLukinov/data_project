"""`ORDER BY` for one report plan: how a caller may rank an answer (ADR-065).

`stats/query.py`'s rule 3 -- identifiers come from the registry, never from a caller -- applied
to the one clause a caller can now shape. An order term names **a column the answer already
has**: one of the request's own group-by dimensions, or one of its own stats. Nothing else is
nameable, so the text that reaches the SQL is an alias the query builder itself wrote.

The second form, `match`, is a ranking that is not a column -- "the exact name first, then the
busiest" (ADR-062 decision 3). It is an ordinary filter tree (ADR-022) and goes through the
ordinary compiler, which re-checks every leaf against the dimension registry and binds every
value it carries. Its dimensions must be grouped by: a column that is not a grouping key
cannot be ranked under `GROUP BY`, and that is a mistake this module names rather than letting
ClickHouse report it.

Two things a caller should know about the order it gets. A stat's value is NULL where its
denominator is zero (`query.value_expr`), and ClickHouse sorts NULLs **last** in both
directions -- so ranking by a stat puts the groups that could not produce one at the bottom,
whichever way the arrow points, which is where a reader wants them. And a `key` names a SELECT
alias, which shadows any mart column of the same name: `ORDER BY hands` is the report's
`sum(s.hands)`, not the rollup's per-day `hands` column.
"""

from __future__ import annotations

from stats.ast import leaves
from stats.compiler import Compiler
from stats.errors import ReportError
from stats.registry import Registry
from stats.request import OrderBy, OrderKey, ReportRequest
from stats.router import Plan

DIRECTIONS: dict[str, str] = {"asc": "ASC", "desc": "DESC"}


def order_by(request: ReportRequest, plan: Plan, compiler: Compiler, reg: Registry) -> str:
    """The ORDER BY terms of a request, or `''` for the default (the group key itself)."""
    allowed = set(request.group_by) | {stat.code for stat in plan.stats}
    terms: list[str] = []
    for i, term in enumerate(request.order_by):
        expr = _term(term, request, allowed, compiler, reg, f"order_by[{i}]")
        terms.append(f"{expr} {DIRECTIONS[term.direction]}")
    return ", ".join(terms)


def _term(
    term: OrderBy,
    request: ReportRequest,
    allowed: set[str],
    compiler: Compiler,
    reg: Registry,
    where: str,
) -> str:
    """One term as SQL: a SELECT alias, or a parenthesised 0/1 predicate."""
    if isinstance(term, OrderKey):
        if term.key not in allowed:
            raise ReportError(
                f"{where}: {term.key!r} is neither a group-by nor a stat of this report"
            )
        return term.key
    for leaf in leaves(term.match):
        if leaf.dim not in request.group_by:
            raise ReportError(f"{where}: {leaf.dim!r} must be grouped by to be ordered on")
        if reg.dimensions[leaf.dim].buckets:
            raise ReportError(f"{where}: {leaf.dim!r} is grouped in buckets; order by the bucket")
    return f"({compiler.node(term.match)})"
