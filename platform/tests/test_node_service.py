"""Tier 1 and tier 2 answers, with a fake runner: the gate matters more than the SQL here.

The rule the tests exist for is spec §10.5 — **never a fabricated number**. Under `min_n` the
answer carries the count and nothing else, so a caller cannot accidentally render a percentage
computed from eleven hands.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from analysis.pool.node_service import MIN_N, frequencies, showdown_range
from analysis.pool.nodes import NodeKey

BTN_3BET = NodeKey.model_validate(
    {
        "hero_position": "BTN",
        "villain_position": "UTG",
        "action_sequence": [
            {"position": "UTG", "action": "raise", "size_bb": 3},
            {"position": "BTN", "action": "raise", "size_bb": 9},
        ],
    }
)

Rows = tuple[list[str], Sequence[Sequence[Any]]]


def runner(groups: dict[str, int], column: str = "action") -> Any:
    """A fake report runner returning one row per group, in the engine's column shape."""

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        assert "s.dataset = {dataset:String}" in sql
        assert params["dataset"] == "population"
        rows = [[name, count, count, count] for name, count in groups.items()]
        return [column, "decisions", "decisions__n", "__hands"], rows

    return run


def test_frequencies_are_shares_of_the_decisions_at_the_node() -> None:
    answer = frequencies(BTN_3BET, 7, run=runner({"fold": 600, "call": 300, "raise": 100}))
    assert answer.tier == 1
    assert answer.sample_size == 1000 and answer.enough is True
    assert answer.frequencies == {"fold": 0.6, "call": 0.3, "raise": 0.1}
    assert answer.actions["raise"] == 100


def test_a_thin_node_reports_its_count_and_no_numbers() -> None:
    answer = frequencies(BTN_3BET, 7, run=runner({"fold": 8, "call": 3}))
    assert answer.sample_size == 11 and answer.enough is False
    assert answer.frequencies == {} and answer.actions == {}
    assert answer.min_n == MIN_N


def test_a_node_nobody_has_played_is_empty_not_zero() -> None:
    answer = frequencies(BTN_3BET, 7, run=runner({}))
    assert answer.sample_size == 0 and answer.enough is False
    assert answer.frequencies == {}


def test_the_showdown_range_says_what_share_of_the_node_it_saw() -> None:
    classes = {"AA": 60, "KK": 50, "AKs": 40, "QQ": 30, "72o": 20}
    seen = sum(classes.values())

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        if "hand_class" in sql and "GROUP BY hand_class" in sql:
            rows = [[name, n, n, n] for name, n in classes.items()]
            return ["hand_class", "decisions", "decisions__n", "__hands"], rows
        return ["action", "decisions", "decisions__n", "__hands"], [["raise", 800, 800, 800]]

    answer = showdown_range(BTN_3BET, 7, run=run)
    assert answer.tier == 2
    assert answer.sample_size == seen and answer.enough is True
    assert answer.decisions_at_node == 800
    assert answer.covers == round(seen / 800, 4)
    assert answer.weights["AA"] == round(60 / seen, 4)


def test_a_thin_showdown_sample_shows_no_range() -> None:
    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        if "GROUP BY hand_class" in sql:
            return ["hand_class", "decisions", "decisions__n", "__hands"], [["AA", 4, 4, 4]]
        return ["action", "decisions", "decisions__n", "__hands"], [["raise", 800, 800, 800]]

    answer = showdown_range(BTN_3BET, 7, run=run)
    assert answer.sample_size == 4 and answer.enough is False
    assert answer.weights == {} and answer.classes == {}
    # The count still tells the caller how little there was, and of what.
    assert answer.decisions_at_node == 800 and answer.covers == 0.005


def test_the_showdown_query_only_counts_revealed_hands() -> None:
    seen: list[str] = []

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        seen.append(sql)
        return ["hand_class", "decisions", "decisions__n", "__hands"], []

    showdown_range(BTN_3BET, 7, run=run)
    assert any("hand_class !=" in sql for sql in seen), seen
