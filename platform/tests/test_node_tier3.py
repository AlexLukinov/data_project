"""Tier 3 and the empirical EQR beside it, on hand-worked numbers (plan F.10).

A reconstruction moves a range the founder will then study, so every number here is one that
can be checked on paper. Two rules are what the tests exist for:

* a bucket the pool barely showed is **not** reweighted — it keeps the prior and says so;
* the reconstruction reports its own error, so `implied_frequency` is compared against the
  frequency tier 1 measured directly and the two agree exactly when nothing was reweighted.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from analysis.pool.node_query import MIN_BUCKET_N, MIN_N
from analysis.pool.nodes import NodeKey
from analysis.pool.realization import realization
from analysis.pool.reconstruct import answered_action, estimated_range

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
COUNT_COLUMNS = ["decisions", "decisions__n", "__hands"]
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


class Pool:
    """A fake pool: what it does at the node, what it showed, and what the shown hands did.

    The three queries tier 3 asks are told apart the way they actually differ — the first
    groups by `action`, and only the third names an action in its parameters.
    """

    def __init__(
        self, actions: dict[str, int], shown: dict[str, int], took: dict[str, int]
    ) -> None:
        self.actions = actions
        self.shown = shown
        self.took = took
        self.sql: list[str] = []

    def __call__(self, sql: str, params: Mapping[str, Any]) -> Rows:
        self.sql.append(sql)
        if "GROUP BY action" in sql:
            rows = [[name, n, n, n] for name, n in self.actions.items()]
            return ["action", *COUNT_COLUMNS], rows
        groups = self.took if "bet" in params.values() else self.shown
        return ["hand_class", *COUNT_COLUMNS], [[name, n, n, n] for name, n in groups.items()]


def test_a_node_that_does_not_end_with_heros_action_has_no_question() -> None:
    with pytest.raises(ValueError, match="last"):
        answered_action(NodeKey.model_validate({"hero_position": "CO", "villain_position": "BB"}))
    facing = NodeKey.model_validate(
        {
            "hero_position": "CO",
            "action_sequence": [{"position": "BB", "action": "bet"}],
        }
    )
    with pytest.raises(ValueError, match="hero's own action"):
        answered_action(facing)


def test_a_limp_is_a_call_and_an_all_in_is_a_raise() -> None:
    """The decision fact records five actions; a node names seven. This is the mapping."""
    limp = NodeKey.model_validate(
        {"hero_position": "BTN", "action_sequence": [{"position": "BTN", "action": "limp"}]}
    )
    shove = NodeKey.model_validate(
        {"hero_position": "BTN", "action_sequence": [{"position": "BTN", "action": "allin"}]}
    )
    assert answered_action(limp) == "call"
    assert answered_action(shove) == "raise"


def test_the_prior_is_reweighted_by_what_each_class_actually_does() -> None:
    # 400 of each class shown, so each is a third of the revealed sample; 560 of them bet.
    # L(AA) = (320/560) / (1/3) = 1.7143, L(KK) = 1.0714, L(72o) = 0.2143, and with the node
    # betting 0.30 the rates are 0.5143 / 0.3214 / 0.0643.
    # Prior 1 : 1 : 2 -> 0.25 / 0.25 / 0.5, so raw 0.12857 / 0.08036 / 0.03214, mass 0.24107.
    pool = Pool(
        actions={"bet": 3000, "check": 7000},
        shown={"AA": 400, "KK": 400, "72o": 400},
        took={"AA": 320, "KK": 200, "72o": 40},
    )
    answer = estimated_range(CO_BET, {"AA": 1, "KK": 1, "72o": 2}, 7, run=pool)

    assert answer.tier == 3 and answer.action == "bet" and answer.enough is True
    by_class = {row.hand_class: row for row in answer.classes}
    assert [row.hand_class for row in answer.classes] == ["AA", "KK", "72o"]
    assert by_class["AA"].prior == 0.25
    assert by_class["AA"].likelihood == 1.7143 and by_class["AA"].action_rate == 0.5143
    assert by_class["AA"].posterior == 0.5333
    assert by_class["KK"].posterior == 0.3333
    assert by_class["72o"].posterior == 0.1333
    assert all(row.fallback is False for row in answer.classes)


def test_a_rate_the_ratio_pushes_over_one_is_capped_at_one() -> None:
    """`action_rate` is a probability. 0.9 * L would read 1.8 for a class that always bets."""
    pool = Pool(
        actions={"bet": 9000, "check": 1000},
        shown={"AA": 400, "72o": 400},
        took={"AA": 400, "72o": 0},
    )
    answer = estimated_range(CO_BET, {"AA": 1, "72o": 1}, 7, run=pool)
    top = next(row for row in answer.classes if row.hand_class == "AA")
    assert top.likelihood == 2.0 and top.action_rate == 1.0


def test_the_reconstruction_reports_how_far_off_the_prior_is() -> None:
    """Implied 0.2411 against the 0.30 tier 1 measured: the prior is heavy on hands that check."""
    pool = Pool(
        actions={"bet": 3000, "check": 7000},
        shown={"AA": 400, "KK": 400, "72o": 400},
        took={"AA": 320, "KK": 200, "72o": 40},
    )
    answer = estimated_range(CO_BET, {"AA": 1, "KK": 1, "72o": 2}, 7, run=pool)

    assert answer.observed_frequency == 0.3
    assert answer.implied_frequency == 0.2411
    assert answer.shown == 1200 and answer.covers == 0.12


def test_a_prior_that_matches_the_field_implies_exactly_what_tier_one_measured() -> None:
    """The property that makes the validation number readable, and the reason for the ratio.

    Ask the reconstruction to explain the pool's own class mix and it reproduces the pool's own
    frequency to the digit — so any gap the founder sees is the prior's, not the estimator's.
    """
    pool = Pool(
        actions={"bet": 3000, "check": 7000},
        shown={"AA": 400, "KK": 400, "72o": 400},
        took={"AA": 320, "KK": 200, "72o": 40},
    )
    answer = estimated_range(CO_BET, {"AA": 1, "KK": 1, "72o": 1}, 7, run=pool)
    assert answer.implied_frequency == answer.observed_frequency == 0.3


def test_a_class_the_pool_barely_showed_keeps_the_prior_and_says_so() -> None:
    thin = MIN_BUCKET_N - 1
    pool = Pool(
        actions={"bet": 3000, "check": 7000},
        shown={"AA": 400, "72o": thin},
        took={"AA": 320, "72o": 0},
    )
    answer = estimated_range(CO_BET, {"AA": 1, "72o": 1}, 7, run=pool)

    by_class = {row.hand_class: row for row in answer.classes}
    assert by_class["72o"].fallback is True and by_class["72o"].sample_size == thin
    # Not the 0.0 its own thin sample would give: it does not move at all.
    assert by_class["72o"].likelihood == 1.0 and by_class["72o"].action_rate == 0.3
    assert by_class["AA"].fallback is False


def test_when_nothing_could_be_reweighted_the_two_frequencies_agree_exactly() -> None:
    """The fallback is chosen so that a reconstruction with no data cannot claim to know more."""
    pool = Pool(actions={"bet": 3000, "check": 7000}, shown={}, took={})
    answer = estimated_range(CO_BET, {"AA": 1, "KK": 3, "72o": 6}, 7, run=pool)

    assert answer.implied_frequency == answer.observed_frequency == 0.3
    assert all(row.fallback for row in answer.classes)
    assert {row.hand_class: row.posterior for row in answer.classes} == {
        "AA": 0.1,
        "KK": 0.3,
        "72o": 0.6,
    }


def test_a_class_with_no_weight_is_not_in_the_range_at_all() -> None:
    pool = Pool(actions={"bet": 3000, "check": 7000}, shown={"AA": 400}, took={"AA": 320})
    answer = estimated_range(CO_BET, {"AA": 1, "72o": 0}, 7, run=pool)
    assert [row.hand_class for row in answer.classes] == ["AA"]


def test_a_node_under_min_n_reconstructs_nothing() -> None:
    pool = Pool(actions={"bet": 4, "check": 7}, shown={"AA": 400}, took={"AA": 320})
    answer = estimated_range(CO_BET, {"AA": 1}, 7, run=pool)

    assert answer.enough is False and answer.classes == []
    assert answer.observed_frequency is None and answer.implied_frequency is None
    # It still asked tier 1 and nothing else: there was no point.
    assert len(pool.sql) == 1


def test_only_revealed_hands_are_bucketed() -> None:
    pool = Pool(actions={"bet": 3000}, shown={"AA": 400}, took={"AA": 320})
    estimated_range(CO_BET, {"AA": 1}, 7, run=pool)
    assert sum("hand_class !=" in sql for sql in pool.sql) == 2


class Realized:
    """A fake pool for the EQR question: one overall row, and a row per revealed class."""

    def __init__(self, overall: Mean, classes: dict[str, Mean]) -> None:
        self.overall = overall
        self.classes = classes
        self.sql: list[str] = []

    def __call__(self, sql: str, params: Mapping[str, Any]) -> Rows:
        self.sql.append(sql)
        if "net_from_here" not in sql:
            return ["action", "decisions", "decisions__n", "__hands"], [["bet", 3000, 3000, 3000]]
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
        return ["action", "decisions", "decisions__n", "__hands"], [["bet", 9, 9, 9]]

    answer = realization(CO_BET, 7, run=thin, built=built)
    assert answer.enough is False and answer.overall is None and answer.by_hand_class == []
    assert answer.min_n == MIN_N and answer.min_bucket_n == MIN_BUCKET_N


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
