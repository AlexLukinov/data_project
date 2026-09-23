"""What every pool-node answer is built from: one report over one node's decisions.

The three tiers (`node_service` for 1 and 2, `reconstruct` for 3, `realization` for the
empirical EQR beside it) all ask the same question in the same way -- `run_report` over
`node_filter(key)`, so tenancy, the dataset rule and caching stay the engine's -- and all obey
the same rule: **never a fabricated number**. Under the gate an answer carries the count and
nothing else.

The measure is always "how many decision rows fall in this group": a node's frequencies are
counts normalized, a showdown range is counts normalized, and a reconstruction is counts
divided by counts. Everything that is not a count (chips won, the pot) is a custom stat the
caller adds.

Tier 1 asks its question **clustered by player** (`ReportRequest.cluster`, ADR-076), so every
frequency comes back with the interval it rests on, and the gate is that interval's width
(`node_gate`). A hand-class bucket is what a player was *dealt*, and `MIN_BUCKET_N` stays a
plain count for that reason (`stats.definitions.Kind`).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from analysis.pool.node_gate import LEVEL, MIN_N
from stats.ast import All, Count, CountIf, Leaf, Node
from stats.interval import PERCENT_SCALE, Interval
from stats.registry import Registry
from stats.request import (
    CLUSTER_PLAYER,
    DATASET_POPULATION,
    Cohort,
    CustomStatSpec,
    ReportRequest,
    ReportResult,
    ReportRow,
)

__all__ = ["MIN_BUCKET_N", "MIN_N", "NodeAnswer"]

MIN_BUCKET_N = 200
"""Observations a *hand-class bucket* needs before it is reweighted (spec §10.3).

Higher than `MIN_N` on purpose: a node's overall frequency is one number over every decision
taken there, while a bucket splits that sample 169 ways and is then used to move a range. A
count and not an interval, because a class is dealt, not chosen (ADR-076).
"""

DECISIONS = CustomStatSpec(
    code="decisions",
    label="Decisions",
    grain="decision",
    format="count",
    numerator=Count(count=True),
)
"""The measure every tier shares: how many decision rows fall in each group."""

MAX_GROUPS = 200
"""Groups one node question may return. 169 hand classes fit; a two-key group-by asks for more."""

REVEALED = Leaf(dim="hand_class", op="ne", value="")
"""Cards were turned over, so the seat's holding is known. The gate on every tier-2/3 sample."""

COUNT_SUFFIX = "_count"
"""`fold` is the frequency stat of an action, `fold_count` its exact count."""

SHARE_DIGITS = 4


def node_request(
    where: Node,
    group_by: list[str],
    cohort: Cohort | None,
    *,
    custom: list[CustomStatSpec] | None = None,
    limit: int = MAX_GROUPS,
) -> ReportRequest:
    """The population report behind a node answer: no hero seat, the node as the filter."""
    return ReportRequest(
        dataset=DATASET_POPULATION,
        hero_only=False,
        filter=where,
        group_by=group_by,
        custom=custom if custom is not None else [DECISIONS],
        cohort=cohort,
        limit=limit,
    )


def action_stats(reg: Registry) -> list[CustomStatSpec]:
    """Two stats per action the registry knows: its frequency, and its exact count.

    The frequency is a *chosen* percent stat -- `countIf(action = a) / count()` -- so under
    `cluster` the engine gives it the player-clustered interval. The count is beside it
    because a percent rounded to two places does not recover an exact count at 556,112 rows.
    """
    specs: list[CustomStatSpec] = []
    for name in reg.dimension("action").values:
        taken = CountIf(count_if=Leaf(dim="action", op="eq", value=name))
        specs.append(
            CustomStatSpec(
                code=name,
                label=name,
                grain="decision",
                format="percent",
                numerator=taken,
                denominator=Count(count=True),
            )
        )
        specs.append(
            CustomStatSpec(
                code=f"{name}{COUNT_SUFFIX}",
                label=name,
                grain="decision",
                format="count",
                numerator=taken,
            )
        )
    return specs


def frequencies_request(where: Node, cohort: Cohort | None, reg: Registry) -> ReportRequest:
    """Tier 1's question: one row, one clustered cell per action, one scan of the node."""
    return ReportRequest(
        dataset=DATASET_POPULATION,
        hero_only=False,
        filter=where,
        group_by=[],
        custom=[DECISIONS, *action_stats(reg)],
        cohort=cohort,
        confidence=LEVEL,
        cluster=CLUSTER_PLAYER,
        limit=1,
    )


def with_leaves(where: Node, *extra: Node) -> All:
    """`where` narrowed by more conditions, kept as one flat `all` the compiler likes."""
    conjuncts = list(where.all) if isinstance(where, All) else [where]
    return All(all=[*conjuncts, *extra])


def counts_by(result: ReportResult, stat: str = "decisions") -> dict[str, int]:
    """Group value -> measure, dropping the empty group a missing column produces."""
    key = result.group_by[0]
    counts: dict[str, int] = {}
    for row in result.rows:
        value = row.group.get(key)
        cell = row.cells.get(stat)
        if value is None or cell is None or cell.value is None:
            continue
        counts[str(value)] = int(cell.value)
    return counts


def action_counts(row: ReportRow | None, reg: Registry) -> dict[str, int]:
    """Action -> exact decisions at the node, for the actions anyone took there."""
    if row is None:
        return {}
    counts: dict[str, int] = {}
    for name in reg.dimension("action").values:
        cell = row.cells.get(f"{name}{COUNT_SUFFIX}")
        if cell is not None and cell.value:
            counts[name] = int(cell.value)
    return counts


def action_intervals(row: ReportRow | None, actions: dict[str, int]) -> dict[str, Interval]:
    """Action -> its clustered interval, as shares of 1 like the frequencies beside it."""
    if row is None:
        return {}
    intervals: dict[str, Interval] = {}
    for name in actions:
        cell = row.cells.get(name)
        if cell is None or cell.interval is None:
            continue
        span = cell.interval
        intervals[name] = span.model_copy(
            update={
                "low": round(span.low / PERCENT_SCALE, SHARE_DIGITS),
                "high": round(span.high / PERCENT_SCALE, SHARE_DIGITS),
            }
        )
    return intervals


def players_behind(row: ReportRow | None, reg: Registry) -> int:
    """The distinct players the node's rows came from, off any action's cell."""
    if row is None:
        return 0
    for name in reg.dimension("action").values:
        cell = row.cells.get(name)
        if cell is not None and cell.players is not None:
            return cell.players
    return 0


def shares(counts: dict[str, int]) -> tuple[int, dict[str, float]]:
    """(total, each group's share of it). An empty sample shares nothing rather than dividing."""
    total = sum(counts.values())
    if total == 0:
        return 0, {}
    return total, {name: round(count / total, SHARE_DIGITS) for name, count in counts.items()}


class NodeAnswer(BaseModel):
    """What every node answer carries: which tier it is, and whether it may show numbers."""

    model_config = ConfigDict(extra="forbid")

    tier: Literal[1, 2, 3]
    sample_size: int
    enough: bool
    min_n: int = MIN_N
    """Observations this node needs before its numbers are shown -- tier 1's requirement is
    per node (`node_gate.verdict`), a dealt sample's is the constant."""
