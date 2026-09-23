"""What the pool actually does at one node, tiers 1 and 2 (spec §10.2-§10.3, plan F.8).

Two questions, both answered by `run_report` over the node's filter, so tenancy, caching and
the dataset rule are the engine's and not repeated here:

  tier 1  *frequencies*     — how often the field folds, calls, raises at this node
  tier 2  *showdown range*  — which hands it turned over there

Tier 3 -- the prior reweighted by what the field does with each class -- is `reconstruct.py`,
and it is built on both of these.

**Never a fabricated number.** A tier-1 frequency travels with its interval, computed over
per-player sums (ADR-076, plan G.3), and `enough` -- the server's verdict (ADR-067) -- says
whether the widest of them is within the bar. Under `MIN_N` rows nothing is measured and the
maps are empty; at or above it the measured frequencies and their intervals are shipped
whatever the verdict, because "fold 45%, ±12 -- too wide to act on" is a measurement and
"insufficient data" alone is not: every reader still guards on `enough` before treating a
number as one to act on, and the badge can now say *why* it is withheld. A tier-2 answer is
additionally honest about its own bias: it can only see hands that reached showdown *and*
were revealed, which is stated in `covers` rather than left for the reader to assume. Its
gate is a count, because a hand class is dealt by the deck (`Kind`).
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from analysis.pool.node_filter import node_filter
from analysis.pool.node_gate import MAX_HALF_WIDTH, MIN_N, verdict_for
from analysis.pool.node_query import (
    REVEALED,
    NodeAnswer,
    action_counts,
    action_intervals,
    counts_by,
    frequencies_request,
    node_request,
    players_behind,
    shares,
    with_leaves,
)
from analysis.pool.nodes import NodeKey
from stats.cluster import MIN_PLAYERS
from stats.definitions import KIND_CHOSEN, KIND_DEALT
from stats.interval import Interval
from stats.registry import Registry, registry
from stats.request import Cohort
from stats.service import Cache, Runner, run_report

__all__ = ["MIN_N", "NodeFrequencies", "NodeShowdownRange", "frequencies", "showdown_range"]


class NodeFrequencies(NodeAnswer):
    """Tier 1: the field's actions at this node, each with the interval it rests on.

    The maps are empty under `min_n`'s floor (`MIN_N` rows) and filled above it whether or
    not `enough`; a reader acts on a frequency only when `enough`, and reads the interval to
    see why not. `intervals` is the cluster-robust 95% interval of each frequency, in the same
    shares (ADR-076); `players` is how many distinct players the sample came from, which is
    what the interval rests on; `design_effect` is the binding action's -- how many rows one
    independent observation was worth here -- when it could be measured. `max_half_width` and
    `min_players` are the bar `enough` was judged against, so a client can say what "enough"
    meant without a constant of its own.
    """

    tier: Literal[1, 2, 3] = 1
    actions: dict[str, int] = Field(default_factory=dict)
    frequencies: dict[str, float] = Field(default_factory=dict)
    intervals: dict[str, Interval] = Field(default_factory=dict)
    players: int = 0
    design_effect: float | None = None
    max_half_width: float = MAX_HALF_WIDTH
    min_players: int = MIN_PLAYERS


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
    cohort: Cohort | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> NodeFrequencies:
    """Tier 1: what the field does at this node, as shares of the decisions taken there.

    One clustered report: a cell per action, each with its own interval, and the exact counts
    beside them. The verdict is the width of the widest interval (`node_gate.verdict`).
    """
    reg = reg or registry()
    request = frequencies_request(node_filter(key, reg), cohort, reg)
    result = run_report(request, tenant_id, run=run, cache=cache, reg=reg)
    row = result.rows[0] if result.rows else None
    counts = action_counts(row, reg)
    total, shares_by_action = shares(counts)
    intervals = action_intervals(row, counts)
    gate = verdict_for(KIND_CHOSEN, total, shares_by_action, intervals, players_behind(row, reg))
    measured = total >= MIN_N
    return NodeFrequencies(
        sample_size=total,
        enough=gate.enough,
        min_n=gate.min_n,
        players=gate.players,
        design_effect=gate.design_effect,
        actions=counts if measured else {},
        frequencies=shares_by_action if measured else {},
        intervals=intervals if measured else {},
    )


def showdown_range(
    key: NodeKey,
    tenant_id: int,
    *,
    cohort: Cohort | None = None,
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
    gate = verdict_for(KIND_DEALT, total, {}, {})
    return NodeShowdownRange(
        sample_size=total,
        enough=gate.enough,
        min_n=gate.min_n,
        decisions_at_node=decisions,
        covers=round(total / decisions, 4) if decisions else 0.0,
        classes=counts if gate.enough else {},
        weights=weights if gate.enough else {},
    )
