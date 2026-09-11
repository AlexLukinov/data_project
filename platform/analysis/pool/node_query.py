"""What every pool-node answer is built from: one report over one node's decisions.

The three tiers (`node_service` for 1 and 2, `reconstruct` for 3, `realization` for the
empirical EQR beside it) all ask the same question in the same way -- `run_report` over
`node_filter(key)`, so tenancy, the dataset rule and caching stay the engine's -- and all obey
the same rule: **never a fabricated number**. Under `MIN_N` observations an answer carries the
count and nothing else.

The measure is always "how many decision rows fall in this group": a node's frequencies are
counts normalized, a showdown range is counts normalized, and a reconstruction is counts
divided by counts. Everything that is not a count (chips won, the pot) is a custom stat the
caller adds.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from stats.ast import All, Count, Leaf, Node
from stats.request import (
    DATASET_POPULATION,
    CohortSpec,
    CustomStatSpec,
    ReportRequest,
    ReportResult,
)

MIN_N = 100
"""Observations a node needs before any frequency is shown. Below it the answer is a count."""

MIN_BUCKET_N = 200
"""Observations a *hand-class bucket* needs before it is reweighted (spec §10.3).

Higher than `MIN_N` on purpose: a node's overall frequency is one number over every decision
taken there, while a bucket splits that sample 169 ways and is then used to move a range.
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


def node_request(
    where: Node,
    group_by: list[str],
    cohort: CohortSpec | None,
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


def shares(counts: dict[str, int]) -> tuple[int, dict[str, float]]:
    """(total, each group's share of it). An empty sample shares nothing rather than dividing."""
    total = sum(counts.values())
    if total == 0:
        return 0, {}
    return total, {name: round(count / total, 4) for name, count in counts.items()}


class NodeAnswer(BaseModel):
    """What every node answer carries: which tier it is, and whether it may show numbers."""

    model_config = ConfigDict(extra="forbid")

    tier: Literal[1, 2, 3]
    sample_size: int
    enough: bool
    min_n: int = MIN_N
