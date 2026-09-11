"""Empirical equity realization: what the field actually won from this node (spec §10.4, F.10).

    EQR = (EV / pot) / equity

The right-hand side splits cleanly in two, and this module owns exactly one half. **The pool's
half** is `EV / pot`: how many chips a seat took away from this point on, as a share of the pot
it was playing for. Both come straight out of the decision fact — `net_won_bb + invested_bb` is
the hand's net with the seat's already-sunk chips added back, which is chips won *from here*,
and `pot_before_bb` is what was in the middle. **The equity half** needs a range, a board and
an evaluator, all of which live in `packages/poker-core`, so it is the front end's; the answer
here carries `realized` and the client divides by the equity it computed (ADR-035).

Two samples, and the difference between them is the point:

*overall* — every decision that took this action, revealed or not. Nothing selects it, so it is
the honest number for "what does this line win here".

*by hand class* — the same, split by holding. Only revealed hands can be split, and a hand is
revealed because it went to showdown, so this sample is the one survivorship has picked over:
a class that usually wins without showdown is under-counted here. `covers` says how much of
the node was ever seen, and a class under `MIN_BUCKET_N` carries its count and no number at all.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from analysis.pool.node_filter import node_filter
from analysis.pool.node_query import (
    DECISIONS,
    MIN_BUCKET_N,
    MIN_N,
    REVEALED,
    NodeAnswer,
    node_request,
    with_leaves,
)
from analysis.pool.node_service import frequencies
from analysis.pool.nodes import NodeKey
from analysis.pool.reconstruct import answered_action
from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from stats.ast import Add, Count, Leaf, Node, Sum
from stats.registry import Registry
from stats.request import CohortSpec, CustomStatSpec, ReportResult
from stats.service import Cache, Runner, run_report

DIGITS = 4

NET_FROM_HERE = CustomStatSpec(
    code="net_from_here",
    label="Won from this point (bb)",
    grain="decision",
    format="ratio",
    numerator=Add(add=[Sum(sum="net_won_bb"), Sum(sum="invested_bb")]),
    denominator=Count(count=True),
)
"""Mean chips won from the decision on. The chips already in the pot are the pot's, not the
seat's, so they are added back to the hand's net before it is a per-decision EV."""

POT = CustomStatSpec(
    code="pot_bb",
    label="Pot (bb)",
    grain="decision",
    format="ratio",
    numerator=Sum(sum="pot_before_bb"),
    denominator=Count(count=True),
)
"""Mean pot in front of the decision — what `net_from_here` is a share of."""

MEASURES = [DECISIONS, NET_FROM_HERE, POT]


class ClassRealization(BaseModel):
    """What one holding took away from this node. Numbers are `None` under `MIN_BUCKET_N`."""

    model_config = ConfigDict(extra="forbid")

    hand_class: str
    sample_size: int
    mean_net_bb: float | None = None
    mean_pot_bb: float | None = None
    realized: float | None = None
    """`mean_net_bb / mean_pot_bb`: EV as a share of the pot. Divide by equity to get EQR."""


class NodeRealization(NodeAnswer):
    """Tier 3's companion: the pool's own realization at this node, class by class."""

    model_config = ConfigDict(extra="forbid")

    tier: Literal[1, 2, 3] = 3
    action: str
    min_bucket_n: int = MIN_BUCKET_N
    covers: float = 0.0
    """Share of the node's decisions whose cards were revealed, so `by_hand_class` is placed."""
    needs_rebuild: bool = False
    """`invested_bb` is not on the built table yet, so the question cannot be asked at all."""
    overall: ClassRealization | None = None
    by_hand_class: list[ClassRealization] = Field(default_factory=list)


def decisions_have_invested_bb() -> bool:
    """Whether the built `decisions` table carries the column empirical EQR is computed from.

    `invested_bb` arrived with plan F.10 and a mart only gains a column when the chain is
    rebuilt (see `macros/incremental.sql`), so between the deploy and the rebuild every query
    here would fail with UNKNOWN_IDENTIFIER. One cached lookup turns that into an answer that
    says what is missing, which is the same rule as every other unanswerable question: name it,
    never let a database error out.
    """
    return _has_column(get_settings().db("marts"), "decisions", "invested_bb")


@lru_cache(maxsize=8)
def _has_column(database: str, table: str, column: str) -> bool:
    rows = (
        clickhouse()
        .query(
            "SELECT count() FROM system.columns WHERE database = {db:String} "
            "AND table = {table:String} AND name = {column:String}",
            parameters={"db": database, "table": table, "column": column},
        )
        .result_rows
    )
    return bool(rows and rows[0][0])


def _row(name: str, n: int, net: float | None, pot: float | None, floor: int) -> ClassRealization:
    """One realization row, with `realized` only where both halves are real numbers.

    `floor` is the sample the row needs: `MIN_N` for the whole node's own mean, the stricter
    `MIN_BUCKET_N` for one holding's, which is a slice of it.
    """
    if n < floor or net is None or pot is None or pot <= 0:
        return ClassRealization(hand_class=name, sample_size=n)
    return ClassRealization(
        hand_class=name,
        sample_size=n,
        mean_net_bb=round(net, DIGITS),
        mean_pot_bb=round(pot, DIGITS),
        realized=round(net / pot, DIGITS),
    )


def _rows(result: ReportResult, floor: int) -> list[ClassRealization]:
    """Every group of a realization report, biggest sample first."""
    key = result.group_by[0]
    rows: list[ClassRealization] = []
    for row in result.rows:
        name = row.group.get(key)
        count = row.cells.get("decisions")
        if name is None or count is None or count.value is None:
            continue
        net = row.cells.get("net_from_here")
        pot = row.cells.get("pot_bb")
        rows.append(
            _row(
                str(name),
                int(count.value),
                net.value if net else None,
                pot.value if pot else None,
                floor,
            )
        )
    return sorted(rows, key=lambda r: (-r.sample_size, r.hand_class))


def realization(
    key: NodeKey,
    tenant_id: int,
    *,
    cohort: CohortSpec | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
    built: Callable[[], bool] | None = None,
) -> NodeRealization:
    """What the field won from this node, overall and by the holding it turned over.

    `built` says whether the mart carries `invested_bb` yet; it defaults to asking ClickHouse
    once, and tests hand in their own so nothing here needs a database.

    Raises `ValueError` when the node names no action, the same rule as tier 3's.
    """
    action = answered_action(key)
    if not (built or decisions_have_invested_bb)():
        return NodeRealization(sample_size=0, enough=False, action=action, needs_rebuild=True)
    at_node = frequencies(key, tenant_id, cohort=cohort, run=run, cache=cache, reg=reg)
    if not at_node.enough:
        return NodeRealization(sample_size=at_node.sample_size, enough=False, action=action)

    took = with_leaves(node_filter(key, reg), Leaf(dim="action", op="eq", value=action))
    ask = _asker(tenant_id, cohort, run, cache, reg)
    # One group per action, and the filter fixes the action, so the answer is a single row.
    overall = ask(took, ["action"], MIN_N)
    by_class = ask(with_leaves(took, REVEALED), ["hand_class"], MIN_BUCKET_N)
    revealed = sum(row.sample_size for row in by_class)
    taken = overall[0].sample_size if overall else 0
    return NodeRealization(
        sample_size=taken,
        enough=taken >= MIN_N,
        action=action,
        covers=round(revealed / taken, DIGITS) if taken else 0.0,
        overall=overall[0] if overall else None,
        by_hand_class=by_class,
    )


def _asker(
    tenant_id: int,
    cohort: CohortSpec | None,
    run: Runner | None,
    cache: Cache | None,
    reg: Registry | None,
) -> Callable[[Node, list[str], int], list[ClassRealization]]:
    """The realization report with everything but the filter and the grouping held fixed."""

    def ask(where: Node, group_by: list[str], floor: int) -> list[ClassRealization]:
        request = node_request(where, group_by, cohort, custom=MEASURES)
        return _rows(run_report(request, tenant_id, run=run, cache=cache, reg=reg), floor)

    return ask


__all__ = [
    "MIN_BUCKET_N",
    "MIN_N",
    "ClassRealization",
    "NodeRealization",
    "decisions_have_invested_bb",
    "realization",
]
