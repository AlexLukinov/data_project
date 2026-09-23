"""The empirical EQR beside tier 3, on hand-worked numbers (plan F.10).

Split from `test_node_tier3.py` when the node tiers grew their gate (plan G.3). The rules
are the same: a class under the bucket threshold carries its count and no number, the
chips already in the pot are added back before a per-decision EV, and under tier 1's gate
the answer repeats tier 1's own requirement rather than a constant.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from node_fakes import frequency_answer, is_frequencies_query

from analysis.pool.node_query import MIN_BUCKET_N, MIN_N
from analysis.pool.node_service import frequencies
from analysis.pool.nodes import NodeKey
from analysis.pool.realization import realization

CO_BET = NodeKey.model_validate(
    {
        "hero_position": "CO",
        "villain_position": "BB",
        "street": "flop",
        "action_sequence": [
            {"position": "BB", "action": "check"},
            {"position": "CO", "action": "bet", "size_pct": 0.5},
        ],
    }
)

Rows = tuple[list[str], Sequence[Sequence[Any]]]
Mean = tuple[int, float, float]
"""One realization group as the fakes state it: decisions, mean net won, mean pot."""
EQR_COLUMNS = [
    "decisions",
    "decisions__n",
    "net_from_here",
    "net_from_here__n",
    "pot_bb",
    "pot_bb__n",
    "__hands",
]


def built() -> bool:
    """Stands in for the column check, so nothing in this file needs a database."""
    return True


class Realized:
    """A fake pool for the EQR question: one overall row, and a row per revealed class."""

    def __init__(self, overall: Mean, classes: dict[str, Mean]) -> None:
        self.overall = overall
        self.classes = classes
        self.sql: list[str] = []

    def __call__(self, sql: str, params: Mapping[str, Any]) -> Rows:
        self.sql.append(sql)
        if is_frequencies_query(sql):
            return frequency_answer({"bet": 3000})
        if "GROUP BY action" in sql:
            n, net, pot = self.overall
            return ["action", *EQR_COLUMNS], [["bet", n, n, net, n, pot, n, n]]
        rows = [[name, n, n, net, n, pot, n, n] for name, (n, net, pot) in self.classes.items()]
        return ["hand_class", *EQR_COLUMNS], rows


def test_realized_is_what_the_field_took_away_as_a_share_of_the_pot() -> None:
    pool = Realized(
        overall=(3000, 2.4, 8.0),
        classes={"AA": (400, 9.0, 10.0), "KK": (300, 3.0, 12.0)},
    )
    answer = realization(CO_BET, 7, run=pool, built=built)

    assert answer.action == "bet" and answer.enough is True
    assert answer.overall is not None and answer.overall.realized == 0.3
    by_class = {row.hand_class: row for row in answer.by_hand_class}
    assert by_class["AA"].realized == 0.9 and by_class["AA"].mean_net_bb == 9.0
    assert by_class["KK"].realized == 0.25
    assert answer.covers == round(700 / 3000, 4)


def test_a_class_under_the_bucket_threshold_carries_its_count_and_no_number() -> None:
    pool = Realized(
        overall=(3000, 2.4, 8.0),
        classes={"AA": (400, 9.0, 10.0), "72o": (MIN_BUCKET_N - 1, -4.0, 9.0)},
    )
    answer = realization(CO_BET, 7, run=pool, built=built)

    thin = next(row for row in answer.by_hand_class if row.hand_class == "72o")
    assert thin.sample_size == MIN_BUCKET_N - 1
    assert thin.realized is None and thin.mean_net_bb is None and thin.mean_pot_bb is None


def test_chips_won_from_here_adds_back_what_was_already_in() -> None:
    """The seat's sunk chips belong to the pot, not to the seat: `net_won_bb + invested_bb`."""
    pool = Realized(overall=(3000, 2.4, 8.0), classes={})
    realization(CO_BET, 7, run=pool, built=built)

    measured = [sql for sql in pool.sql if "net_from_here" in sql]
    assert measured, pool.sql
    assert all("net_won_bb" in sql and "invested_bb" in sql for sql in measured)


def test_a_node_under_min_n_realizes_nothing() -> None:
    def thin(sql: str, params: Mapping[str, Any]) -> Rows:
        return frequency_answer({"bet": 9})

    answer = realization(CO_BET, 7, run=thin, built=built)
    assert answer.enough is False and answer.overall is None and answer.by_hand_class == []
    # What the node needs is tier 1's own requirement, repeated here (ADR-076).
    assert answer.min_n == frequencies(CO_BET, 7, run=thin).min_n > MIN_N
    assert answer.min_bucket_n == MIN_BUCKET_N


def test_before_the_rebuild_the_question_is_named_not_answered() -> None:
    """`invested_bb` lands on the mart only when the chain is rebuilt (plan F.10).

    Until then every EQR query would fail on an unknown identifier, so the answer says which
    column is missing instead — and nothing is asked of ClickHouse at all.
    """
    pool = Realized(overall=(3000, 2.4, 8.0), classes={"AA": (400, 9.0, 10.0)})
    answer = realization(CO_BET, 7, run=pool, built=lambda: False)

    assert answer.needs_rebuild is True and answer.enough is False
    assert answer.overall is None and answer.by_hand_class == []
    assert pool.sql == []
