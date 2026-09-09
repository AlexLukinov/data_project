"""Stat codes and inline custom stats -> one shape the router and the query builder read."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from stats.ast import Expr, leaves, terms
from stats.checks import check_expr
from stats.definitions import TABLE_FOR_GRAIN, Format, Grain, Table
from stats.errors import RegistryError, ReportError
from stats.registry import Registry
from stats.request import CustomStatSpec, ReportRequest

DEFAULT_STATS = ("hands", "vpip", "pfr", "threebet", "bb_per_100")
"""What a report with no stats asks for: the dashboard's first line."""


@dataclass(frozen=True, slots=True)
class ResolvedStat:
    """A built-in or a custom stat, normalized: the query builder sees no difference."""

    code: str
    label: str
    grain: Grain
    format: Format
    numerator: Expr
    denominator: Expr | None
    cached: bool
    description: str = ""

    @property
    def table(self) -> Table:
        """The fact table this stat is computed on."""
        return TABLE_FOR_GRAIN[self.grain]


def resolve_stats(request: ReportRequest, reg: Registry) -> list[ResolvedStat]:
    """Every stat the request names, built-ins first, each validated against the registry."""
    codes = request.stats or ([] if request.custom else list(DEFAULT_STATS))
    resolved: list[ResolvedStat] = []
    seen: set[str] = set()
    for code in codes:
        if code in seen:
            continue
        seen.add(code)
        resolved.append(_builtin(code, reg))
    for spec in request.custom:
        stat = _custom(spec, reg)
        if stat.code in seen:
            raise ReportError(f"duplicate stat code {stat.code!r}")
        seen.add(stat.code)
        resolved.append(stat)
    return resolved


def _builtin(code: str, reg: Registry) -> ResolvedStat:
    try:
        stat = reg.stat(code)
    except RegistryError as exc:
        raise ReportError(f"unknown stat {code!r}") from exc
    return ResolvedStat(
        code=stat.code,
        label=stat.label,
        grain=stat.grain,
        format=stat.format,
        numerator=stat.numerator_expr,
        denominator=stat.denominator_expr,
        cached=stat.cached,
        description=stat.description,
    )


def _custom(spec: CustomStatSpec, reg: Registry) -> ResolvedStat:
    """A custom stat may not take a built-in's or a dimension's name, and must compile."""
    if spec.code in reg.stats:
        raise ReportError(f"{spec.code!r} shadows a built-in stat")
    if spec.code in reg.dimensions:
        raise ReportError(f"{spec.code!r} is a dimension name")
    table = TABLE_FOR_GRAIN[spec.grain]
    try:
        check_expr(spec.numerator, reg.dimensions, table, f"custom {spec.code}: numerator")
        if spec.denominator is not None:
            check_expr(spec.denominator, reg.dimensions, table, f"custom {spec.code}: denominator")
    except RegistryError as exc:
        raise ReportError(str(exc)) from exc
    return ResolvedStat(
        code=spec.code,
        label=spec.label or spec.code,
        grain=spec.grain,
        format=spec.format,
        numerator=spec.numerator,
        denominator=spec.denominator,
        cached=False,
    )


def dimensions_used(request: ReportRequest) -> Iterator[str]:
    """Every dimension code the filter or the group-by names (duplicates included)."""
    for leaf in leaves(request.filter):
        yield leaf.dim
    yield from request.group_by


def stat_dimensions(stat: ResolvedStat) -> Iterator[str]:
    """Every dimension a stat's own expressions name."""
    for expr in (stat.numerator, stat.denominator):
        if expr is None:
            continue
        for term in terms(expr):
            if hasattr(term, "sum"):
                yield term.sum
            elif hasattr(term, "count_if"):
                for leaf in leaves(term.count_if):
                    yield leaf.dim
