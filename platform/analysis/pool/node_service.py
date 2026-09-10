"""What the pool actually does at one node (spec §10.2-§10.3, plan F.8).

Two questions, both answered by `run_report` over the node's filter, so tenancy, caching and
the dataset rule are the engine's and not repeated here:

  tier 1  *frequencies*     — how often the field folds, calls, raises at this node
  tier 2  *showdown range*  — which hands it turned over there

**Never a fabricated number.** Under `MIN_N` observations the answer carries no figures at all,
only the count and `enough=False`; the UI shows "insufficient data" (spec §10.5). A tier-2
answer is additionally honest about its own bias: it can only see hands that reached showdown
*and* were revealed, which is stated in `covers` rather than left for the reader to assume.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from analysis.pool.node_filter import node_filter
from analysis.pool.nodes import NodeKey
from stats.ast import All, Count, Leaf, Node
from stats.registry import Registry
from stats.request import (
    DATASET_POPULATION,
    CohortSpec,
    CustomStatSpec,
    ReportRequest,
    ReportResult,
)
from stats.service import Cache, Runner, run_report

MIN_N = 100
"""Observations a node needs before any frequency is shown. Below it the answer is a count."""

DECISIONS = CustomStatSpec(
    code="decisions",
    label="Decisions",
    grain="decision",
    format="count",
    numerator=Count(count=True),
)
"""The measure both tiers use: how many decision rows fall in each group."""

MAX_GROUPS = 200


class NodeAnswer(BaseModel):
    """What every node answer carries: which tier it is, and whether it may show numbers."""

    model_config = ConfigDict(extra="forbid")

    tier: Literal[1, 2]
    sample_size: int
    enough: bool
    min_n: int = MIN_N


class NodeFrequencies(NodeAnswer):
    """Tier 1: the field's actions at this node. Empty maps when `enough` is false."""

    tier: Literal[1, 2] = 1
    actions: dict[str, int] = {}
    frequencies: dict[str, float] = {}


class NodeShowdownRange(NodeAnswer):
    """Tier 2: the hands shown down at this node, by 169-combo class.

    `covers` is the share of the node's decisions whose cards were revealed — the honest
    denominator, since a showdown range can only ever be "of the hands shown here".
    """

    tier: Literal[1, 2] = 2
    decisions_at_node: int = 0
    covers: float = 0.0
    classes: dict[str, int] = {}
    weights: dict[str, float] = {}


def _request(where: Node, group_by: list[str], cohort: CohortSpec | None) -> ReportRequest:
    return ReportRequest(
        dataset=DATASET_POPULATION,
        hero_only=False,
        filter=where,
        group_by=group_by,
        # The one measure, as a custom stat: `stats` names built-ins only, and naming none
        # with a custom present is what keeps the default stat set out of the answer.
        custom=[DECISIONS],
        cohort=cohort,
        limit=MAX_GROUPS,
    )


def _counts(result: ReportResult) -> dict[str, int]:
    """Group value -> decisions, dropping the empty group a missing column produces."""
    key = result.group_by[0]
    counts: dict[str, int] = {}
    for row in result.rows:
        value = row.group.get(key)
        cell = row.cells.get("decisions")
        if value is None or cell is None or cell.value is None:
            continue
        counts[str(value)] = int(cell.value)
    return counts


def _shares(counts: dict[str, int]) -> tuple[int, dict[str, float]]:
    total = sum(counts.values())
    if total == 0:
        return 0, {}
    return total, {name: round(count / total, 4) for name, count in counts.items()}


def frequencies(
    key: NodeKey,
    tenant_id: int,
    *,
    cohort: CohortSpec | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> NodeFrequencies:
    """Tier 1: what the field does at this node, as shares of the decisions taken there."""
    request = _request(node_filter(key, reg), ["action"], cohort)
    result = run_report(request, tenant_id, run=run, cache=cache, reg=reg)
    counts = _counts(result)
    total, shares = _shares(counts)
    enough = total >= MIN_N
    return NodeFrequencies(
        sample_size=total,
        enough=enough,
        actions=counts if enough else {},
        frequencies=shares if enough else {},
    )


def showdown_range(
    key: NodeKey,
    tenant_id: int,
    *,
    cohort: CohortSpec | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> NodeShowdownRange:
    """Tier 2: the hands the field turned over at this node, by 169-combo class.

    Only decisions whose cards were revealed count, so the answer is "of the hands shown here",
    never "of the hands played here" -- `covers` carries that ratio so the UI can say it.
    """
    where = node_filter(key, reg)
    shown = All(all=[*_leaves(where), Leaf(dim="hand_class", op="ne", value="")])
    result = run_report(
        _request(shown, ["hand_class"], cohort), tenant_id, run=run, cache=cache, reg=reg
    )
    counts = _counts(result)
    total, shares = _shares(counts)
    at_node = frequencies(key, tenant_id, cohort=cohort, run=run, cache=cache, reg=reg)
    decisions = at_node.sample_size
    enough = total >= MIN_N
    return NodeShowdownRange(
        sample_size=total,
        enough=enough,
        decisions_at_node=decisions,
        covers=round(total / decisions, 4) if decisions else 0.0,
        classes=counts if enough else {},
        weights=shares if enough else {},
    )


def _leaves(where: Node) -> list[Node]:
    """The conjuncts of a filter built by `node_filter`, which is always an `all`."""
    return list(where.all) if isinstance(where, All) else [where]
