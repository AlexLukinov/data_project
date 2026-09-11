"""What the pool actually does at one node, tiers 1 and 2 (spec §10.2-§10.3, plan F.8).

Two questions, both answered by `run_report` over the node's filter, so tenancy, caching and
the dataset rule are the engine's and not repeated here:

  tier 1  *frequencies*     — how often the field folds, calls, raises at this node
  tier 2  *showdown range*  — which hands it turned over there

Tier 3 -- the prior reweighted by what the field does with each class -- is `reconstruct.py`,
and it is built on both of these.

**Never a fabricated number.** Under `MIN_N` observations the answer carries no figures at all,
only the count and `enough=False`; the UI shows "insufficient data" (spec §10.5). A tier-2
answer is additionally honest about its own bias: it can only see hands that reached showdown
*and* were revealed, which is stated in `covers` rather than left for the reader to assume.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from analysis.pool.node_filter import node_filter
from analysis.pool.node_query import (
    MIN_N,
    REVEALED,
    NodeAnswer,
    counts_by,
    node_request,
    shares,
    with_leaves,
)
from analysis.pool.nodes import NodeKey
from stats.registry import Registry
from stats.request import CohortSpec
from stats.service import Cache, Runner, run_report

__all__ = ["MIN_N", "NodeFrequencies", "NodeShowdownRange", "frequencies", "showdown_range"]


class NodeFrequencies(NodeAnswer):
    """Tier 1: the field's actions at this node. Empty maps when `enough` is false."""

    tier: Literal[1, 2, 3] = 1
    actions: dict[str, int] = Field(default_factory=dict)
    frequencies: dict[str, float] = Field(default_factory=dict)


class NodeShowdownRange(NodeAnswer):
    """Tier 2: the hands shown down at this node, by 169-combo class.

    `covers` is the share of the node's decisions whose cards were revealed — the honest
    denominator, since a showdown range can only ever be "of the hands shown here".
    """

    tier: Literal[1, 2, 3] = 2
    decisions_at_node: int = 0
    covers: float = 0.0
    classes: dict[str, int] = Field(default_factory=dict)
    weights: dict[str, float] = Field(default_factory=dict)


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
    request = node_request(node_filter(key, reg), ["action"], cohort)
    result = run_report(request, tenant_id, run=run, cache=cache, reg=reg)
    counts = counts_by(result)
    total, shares_by_action = shares(counts)
    enough = total >= MIN_N
    return NodeFrequencies(
        sample_size=total,
        enough=enough,
        actions=counts if enough else {},
        frequencies=shares_by_action if enough else {},
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
    shown = with_leaves(node_filter(key, reg), REVEALED)
    result = run_report(
        node_request(shown, ["hand_class"], cohort), tenant_id, run=run, cache=cache, reg=reg
    )
    counts = counts_by(result)
    total, weights = shares(counts)
    at_node = frequencies(key, tenant_id, cohort=cohort, run=run, cache=cache, reg=reg)
    decisions = at_node.sample_size
    enough = total >= MIN_N
    return NodeShowdownRange(
        sample_size=total,
        enough=enough,
        decisions_at_node=decisions,
        covers=round(total / decisions, 4) if decisions else 0.0,
        classes=counts if enough else {},
        weights=weights if enough else {},
    )
