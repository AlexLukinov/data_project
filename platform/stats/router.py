"""Which table answers a report (POKER_PLAN.md §2.6; fixes docs/POKER_AUDIT.md B4).

The rollup is cheapest and serves a request only when EVERY stat is cached and EVERY
dimension the filter or the group-by names lives on it. Otherwise the stats split by grain --
hand-grain on `player_hands`, decision-grain on `decisions` -- and each query's dimensions must
exist on its table: "VPIP when facing a 3-bet" is not a question a hand-grain stat can answer,
and the router says so instead of letting ClickHouse fail on an unknown column.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from stats.definitions import TABLE_FOR_GRAIN, Dimension, Table
from stats.errors import RegistryError, ReportError
from stats.registry import Registry
from stats.resolve import ResolvedStat

ROLLUP: Table = "stats_daily"


@dataclass(frozen=True, slots=True)
class Plan:
    """One query: these stats, on this table."""

    table: Table
    stats: tuple[ResolvedStat, ...]


def plan(
    stats: Sequence[ResolvedStat],
    dims_used: Iterable[str],
    reg: Registry,
    *,
    dispersion: bool = False,
    cluster: bool = False,
) -> list[Plan]:
    """At most two plans, cheapest table first.

    `dispersion` is set when the caller asked for confidence intervals. The rollup holds a
    daily sum and a daily count per stat and **no sum of squares**, so the per-hand spread a
    per-100 interval needs cannot be recovered from it at any cost. Asking for that interval
    therefore costs the rollup: the report drops to the fact tables, where `stddevSamp` is
    available. Proportions are unaffected -- Wilson needs only the value and `n`, both of
    which the rollup already sums exactly (plan E.2, ADR-040). `cluster` (plan G.3) drops to
    the facts too: nothing nests the rollup's `WITH` prologue in a per-player aggregate yet.
    """
    dims = _dimensions(dims_used, reg)
    rollup_serves = all(s.cached for s in stats) and all(ROLLUP in d.tables for d in dims)
    if cluster or (dispersion and any(s.dispersion is not None for s in stats)):
        rollup_serves = False
    if rollup_serves:
        return [Plan(ROLLUP, tuple(stats))]
    plans: list[Plan] = []
    for grain in ("hand", "decision"):
        mine = tuple(s for s in stats if s.grain == grain)
        if not mine:
            continue
        table = TABLE_FOR_GRAIN[grain]
        for dim in dims:
            if table not in dim.tables:
                raise ReportError(
                    f"dimension {dim.code!r} is not available for {grain}-grain stat "
                    f"{mine[0].code!r} (it is on {dim.tables})"
                )
        plans.append(Plan(table, mine))
    return plans


def _dimensions(codes: Iterable[str], reg: Registry) -> list[Dimension]:
    found: dict[str, Dimension] = {}
    for code in codes:
        if code in found:
            continue
        try:
            found[code] = reg.dimension(code)
        except RegistryError as exc:
            raise ReportError(f"unknown dimension {code!r}") from exc
    return list(found.values())
