"""Tier 3: a prior range reweighted by what the field does with each class (spec §10.3, F.10).

    P(combo | action) ∝ P(action | combo) * P(combo)

`P(combo)` is the prior the caller brings — their own chart, a solver range, or the parent
node's estimate. `P(action | combo)` is not observable per combo, so it is estimated **per
169-combo class** from the hands the field turned over at this node and applied to every combo
in that class (spec §10.3).

**How it is estimated matters more than it looks, because hole cards are seen only at
showdown.** The obvious reading of the spec — count the revealed hands of a class and take the
share that took the action — is wrong on this corpus, and not by a little. A seat that folds
is almost never shown, so among the revealed hands nearly everything continued: measured that
way the field opens UTG with 97% of AQs, 85% of KTo and 80% of QTo, at a node where tier 1 says
it opens 18.35% of the time at all. Every class saturates near 1, the differences between them
are noise, and a range reweighted by those numbers would be confidently wrong.

What survives the bias is the **likelihood ratio**: how over-represented a class is among the
hands that took this action, against how often it appears at this node at all.

    L(class) = share of the action's revealed hands / share of all revealed hands here

Write `r(a)` for the chance a hand that took action `a` is ever shown. In both halves of that
fraction the class's hands are revealed at the same rate, so `r` cancels where it saturates:
`L` is 1 when a class takes the action exactly as often as the node's average, above 1 when it
takes it more, and never runs into the ceiling that sinks the direct estimate. The per-class
rate the answer reports is then `P(action | class) = P(action) * L(class)`, capped at 1 because
it is a probability — and the ordering of `L` across classes, not its level, is what moves the
range.

Two more guards:

*Sample size per bucket.* Under `MIN_BUCKET_N` revealed decisions a class is **not** reweighted
at all: `L` is 1, its prior weight does not move, and `fallback` says so, so the UI can grey it
out instead of drawing a number nobody measured.

*The validation view.* `implied_frequency` is what the reweighting says the field's action
frequency should be — the prior-weighted mean of the per-class rates — and
`observed_frequency` is tier 1, which is unbiased because every decision records its action.
The two are equal exactly when the prior matches the class mix the field itself shows here, so
the gap between them is a measure of how far the prior is from the pool: positive means the
prior is heavy on hands that take this action, negative that it is heavy on hands that do not.
When nothing could be reweighted they are equal by construction, which is the honest answer for
a node the showdown data says nothing about (spec §10.3).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from analysis.pool.node_filter import node_filter
from analysis.pool.node_query import (
    MIN_BUCKET_N,
    REVEALED,
    NodeAnswer,
    counts_by,
    node_request,
    with_leaves,
)
from analysis.pool.node_service import frequencies
from analysis.pool.nodes import NodeAction, NodeKey
from stats.ast import Leaf
from stats.registry import Registry
from stats.request import CohortSpec
from stats.service import Cache, Runner, run_report

ANSWERED_AS: dict[NodeAction, str] = {
    "fold": "fold",
    "check": "check",
    "call": "call",
    "limp": "call",
    "bet": "bet",
    "raise": "raise",
    "allin": "raise",
}
"""A node action as `marts.decisions.action` spells it.

A limp is a preflop call and an all-in is a raise, the same reading as `node_filter.LETTER`:
the decision fact records the action, with the all-in kept apart in its own `is_allin` column.
"""

DIGITS = 4


class ClassEstimate(BaseModel):
    """One 169-combo class, before and after the field's own behaviour is applied."""

    model_config = ConfigDict(extra="forbid")

    hand_class: str
    prior: float
    """The class's share of the prior range, so the two columns are comparable."""
    posterior: float
    likelihood: float
    """How much this class moves: 1.0 is "takes this action as often as the node's average"."""
    action_rate: float
    """P(action | class) = the node's own frequency times `likelihood`, capped at 1."""
    sample_size: int
    """Decisions of this class revealed at this node — what `likelihood` is measured from."""
    fallback: bool
    """True when the sample was too small to reweight and the prior was left alone."""


class NodeEstimatedRange(NodeAnswer):
    """Tier 3: the prior after the field's behaviour, with the check on whether it holds up."""

    model_config = ConfigDict(extra="forbid")

    tier: Literal[1, 2, 3] = 3
    action: str
    min_bucket_n: int = MIN_BUCKET_N
    shown: int = 0
    """Revealed decisions at the node, all classes together."""
    covers: float = 0.0
    """Their share of every decision taken here: how much of the node the estimate ever saw."""
    observed_frequency: float | None = None
    implied_frequency: float | None = None
    classes: list[ClassEstimate] = Field(default_factory=list)


def answered_action(key: NodeKey) -> str:
    """The action the key's last step takes — the one tier 3 reconstructs the range for.

    Raises `ValueError` when the sequence is empty or does not end with hero's own action,
    which is the convention every node obeys (ADR-028) and without which there is no question.
    """
    last = key.action_sequence[-1] if key.action_sequence else None
    if last is None:
        raise ValueError("a node needs an action sequence: its last step is the action to explain")
    if last.position != key.hero_position:
        raise ValueError(
            f"the sequence ends with {last.position}, not {key.hero_position}: a node's last "
            "step is hero's own action"
        )
    return ANSWERED_AS[last.action]


def _class_counts(
    key: NodeKey,
    tenant_id: int,
    action: str | None,
    cohort: CohortSpec | None,
    run: Runner | None,
    cache: Cache | None,
    reg: Registry | None,
) -> dict[str, int]:
    """Revealed decisions at the node by hand class, optionally only those taking `action`."""
    extra = [REVEALED] if action is None else [REVEALED, Leaf(dim="action", op="eq", value=action)]
    where = with_leaves(node_filter(key, reg), *extra)
    result = run_report(
        node_request(where, ["hand_class"], cohort), tenant_id, run=run, cache=cache, reg=reg
    )
    return counts_by(result)


def _likelihoods(shown: dict[str, int], took: dict[str, int]) -> Callable[[str], float]:
    """How over-represented each class is among the hands that took the action.

    `(took[c] / all took) / (shown[c] / all shown)`. Both halves count only revealed hands, so
    the chance of ever being shown divides out — which is the whole reason this and not the
    direct `took[c] / shown[c]`, whose ceiling the showdown bias pins every class against.

    The two totals are the same for every class, so they are summed once and closed over.
    """
    total_shown, total_took = sum(shown.values()), sum(took.values())

    def ratio(name: str) -> float:
        seen = shown.get(name, 0)
        if seen <= 0 or total_shown <= 0 or total_took <= 0:
            return 1.0
        return (took.get(name, 0) / total_took) / (seen / total_shown)

    return ratio


def _estimates(
    prior: dict[str, float], shown: dict[str, int], took: dict[str, int], observed: float
) -> list[ClassEstimate]:
    """Reweight each class by its own likelihood, or leave it alone when too few were seen.

    Full precision: `estimated_range` reads the rows back for the validation number before
    `_rounded` trims them for the wire.
    """
    total = sum(weight for weight in prior.values() if weight > 0)
    likelihood = _likelihoods(shown, took)
    rows: list[ClassEstimate] = []
    for name, weight in prior.items():
        if weight <= 0 or total <= 0:
            continue
        seen = shown.get(name, 0)
        enough = seen >= MIN_BUCKET_N
        ratio = likelihood(name) if enough else 1.0
        rows.append(
            ClassEstimate(
                hand_class=name,
                prior=weight / total,
                posterior=0.0,
                likelihood=ratio,
                action_rate=min(1.0, observed * ratio),
                sample_size=seen,
                fallback=not enough,
            )
        )
    return _with_posteriors(rows)


def _with_posteriors(rows: list[ClassEstimate]) -> list[ClassEstimate]:
    """Fill in `posterior`: prior times rate, renormalized. An all-zero reweighting keeps it."""
    mass = sum(row.prior * row.action_rate for row in rows)
    for row in rows:
        row.posterior = row.prior * row.action_rate / mass if mass > 0 else row.prior
    return sorted(rows, key=lambda row: (-row.posterior, row.hand_class))


def _rounded(rows: list[ClassEstimate]) -> list[ClassEstimate]:
    """The same rows at wire precision. Rounding last keeps the validation number exact."""
    for row in rows:
        row.prior = round(row.prior, DIGITS)
        row.posterior = round(row.posterior, DIGITS)
        row.likelihood = round(row.likelihood, DIGITS)
        row.action_rate = round(row.action_rate, DIGITS)
    return rows


def estimated_range(
    key: NodeKey,
    prior: dict[str, float],
    tenant_id: int,
    *,
    cohort: CohortSpec | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> NodeEstimatedRange:
    """The prior range as the field's own behaviour at this node reshapes it.

    `prior` maps a 169-combo class to any positive weight; only the relative sizes matter.
    Raises `ValueError` when the node names no action to explain.
    """
    action = answered_action(key)
    at_node = frequencies(key, tenant_id, cohort=cohort, run=run, cache=cache, reg=reg)
    if not at_node.enough:
        return NodeEstimatedRange(sample_size=at_node.sample_size, enough=False, action=action)

    shown = _class_counts(key, tenant_id, None, cohort, run, cache, reg)
    took = _class_counts(key, tenant_id, action, cohort, run, cache, reg)
    observed = at_node.frequencies.get(action, 0.0)
    rows = _estimates(prior, shown, took, observed)
    implied = sum(row.prior * row.action_rate for row in rows)
    revealed = sum(shown.values())
    return NodeEstimatedRange(
        sample_size=at_node.sample_size,
        enough=True,
        action=action,
        shown=revealed,
        covers=round(revealed / at_node.sample_size, DIGITS) if at_node.sample_size else 0.0,
        observed_frequency=observed,
        implied_frequency=round(implied, DIGITS),
        classes=_rounded(rows),
    )
