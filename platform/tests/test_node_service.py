"""Tier 1 and tier 2 answers, with a fake runner: the gate matters more than the SQL here.

The rule the tests exist for is spec §10.5 — **never a fabricated number** — as plan G.3
reads it (ADR-076): a frequency travels with its cluster-robust interval, `enough` is the
width of the widest one, and `min_n` is what *this* node needs, so a caller cannot render a
percentage computed from eleven hands and cannot render one whose 95% interval is ±21 points
either.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from node_fakes import (
    DEFAULT_PLAYERS,
    Rows,
    frequency_answer,
    is_frequencies_query,
    players_answer,
)

from analysis.pool.node_gate import (
    DEFAULT_DESIGN_EFFECT,
    LEVEL,
    MAX_HALF_WIDTH,
    MIN_N,
    typical_requirement,
)
from analysis.pool.node_query import frequencies_request
from analysis.pool.node_service import frequencies, showdown_range
from analysis.pool.nodes import NodeKey
from stats.ast import All
from stats.cluster import MIN_PLAYERS, needed
from stats.registry import registry
from stats.request import MAX_CUSTOM
from stats.resolve import resolve_stats

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


def runner(groups: dict[str, int], players: int = DEFAULT_PLAYERS) -> Any:
    """A fake report runner answering tier 1's clustered query for identical players."""

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        assert "s.dataset = {dataset:String}" in sql
        assert params["dataset"] == "population"
        assert is_frequencies_query(sql), sql
        return frequency_answer(groups, players)

    return run


def test_frequencies_are_shares_of_the_decisions_at_the_node() -> None:
    answer = frequencies(BTN_3BET, 7, run=runner({"fold": 600, "call": 300, "raise": 100}))
    assert answer.tier == 1
    assert answer.sample_size == 1000 and answer.enough is True
    assert answer.frequencies == {"fold": 0.6, "call": 0.3, "raise": 0.1}
    assert answer.actions["raise"] == 100
    assert answer.players == DEFAULT_PLAYERS


def test_every_frequency_carries_its_interval_and_the_gate_is_its_width() -> None:
    """Identical players: no between-player spread, design effect 1, plain Wilson on 1,000."""
    answer = frequencies(BTN_3BET, 7, run=runner({"fold": 600, "call": 300, "raise": 100}))
    fold = answer.intervals["fold"]
    assert fold.method == "cluster" and fold.players == DEFAULT_PLAYERS
    assert fold.low < 0.6 < fold.high and fold.high - 0.6 < MAX_HALF_WIDTH
    assert fold.design_effect == 1.0 and fold.effective_n == 1000.0
    assert answer.design_effect == 1.0
    # What the node needs is the binding action's -- fold, nearest 50% -- at its own design
    # effect: fewer rows than it has, which is what `enough` means.
    assert answer.min_n == max(MIN_N, needed(0.6, 1.0, MAX_HALF_WIDTH, LEVEL)) <= 1000
    assert answer.max_half_width == MAX_HALF_WIDTH and answer.min_players == MIN_PLAYERS


def test_a_thin_node_reports_its_count_and_no_numbers() -> None:
    answer = frequencies(BTN_3BET, 7, run=runner({"fold": 8, "call": 3}))
    assert answer.sample_size == 11 and answer.enough is False
    assert answer.frequencies == {} and answer.actions == {} and answer.intervals == {}
    # Under the floor nothing is measured, so what it needs is the pool's typical
    # requirement at the widest frequency -- an estimate of the same thing a measured node
    # prints, never the floor itself, which would jump 17x the moment it was reached.
    assert answer.min_n == typical_requirement()
    assert answer.min_n == needed(0.5, DEFAULT_DESIGN_EFFECT, MAX_HALF_WIDTH, LEVEL) > MIN_N


def test_a_node_nobody_has_played_is_empty_not_zero() -> None:
    answer = frequencies(BTN_3BET, 7, run=runner({}))
    assert answer.sample_size == 0 and answer.enough is False
    assert answer.frequencies == {} and answer.players == 0


def test_a_wide_node_ships_its_numbers_and_says_they_are_not_enough() -> None:
    """Twenty players who always fold and twenty who never do: p = 0.5 over 400 rows.

    `Σ(x_i - p·n_i)² = 40 · 25 = 1,000`, `Var_c = 40/39 · 1000 / 400² = 0.00641`,
    `Var_b = 0.25 / 400 = 0.000625`: a design effect of 10.26 and an effective sample of 39.
    The measured frequency is real and is shipped; the verdict is that it cannot be acted on.
    """
    seats = [{"fold": 10}] * 20 + [{"call": 10}] * 20

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        return players_answer(seats)

    answer = frequencies(BTN_3BET, 7, run=run)
    assert answer.sample_size == 400 and answer.players == 40
    assert answer.enough is False
    assert answer.frequencies == {"fold": 0.5, "call": 0.5}
    fold = answer.intervals["fold"]
    assert fold.design_effect == 10.256 and fold.effective_n == 39.0
    # Wilson on 39 effective observations at a coin flip: about ±15 points.
    assert (fold.low, fold.high) == (0.3503, 0.6497)
    assert 0.5 - fold.low > MAX_HALF_WIDTH
    assert answer.min_n == needed(0.5, 10.256, MAX_HALF_WIDTH, LEVEL) > 400


def test_under_thirty_players_there_is_no_interval_and_no_verdict_in_favour() -> None:
    answer = frequencies(BTN_3BET, 7, run=runner({"fold": 600, "call": 400}, players=8))
    assert answer.sample_size == 1000 and answer.players == 8
    assert answer.enough is False and answer.intervals == {}
    assert answer.frequencies == {"fold": 0.6, "call": 0.4}  # measured, shipped, not enough


def test_everyone_folding_is_not_a_zero_width_interval() -> None:
    """p = 1: nothing varied, so no design effect can be measured. The worst case is assumed
    -- every player a constant -- and the effective sample is Kish's `N² / Σn_i²`, here 100
    identical players, so the band is Wilson's at n = 100 and the effect is reported as none."""
    answer = frequencies(BTN_3BET, 7, run=runner({"fold": 1000}, players=100))
    fold = answer.intervals["fold"]
    assert fold.design_effect is None and fold.effective_n == 100.0
    assert fold.high == 1.0 and 0.95 < fold.low < 0.97
    assert answer.enough is True and answer.design_effect is None


def test_the_tier_one_question_is_one_clustered_report_the_registry_accepts() -> None:
    reg = registry()
    request = frequencies_request(All(all=[]), None, reg)
    assert request.cluster == "player" and request.confidence == LEVEL
    assert len(request.custom) <= MAX_CUSTOM
    # Every custom code is free: a registry stat or dimension of the same name would be
    # refused by the resolver, and the counts and frequencies must not shadow each other.
    resolved = resolve_stats(request, reg)
    assert len({stat.code for stat in resolved}) == len(request.custom)


def test_the_showdown_range_says_what_share_of_the_node_it_saw() -> None:
    classes = {"AA": 60, "KK": 50, "AKs": 40, "QQ": 30, "72o": 20}
    seen = sum(classes.values())

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        if "GROUP BY hand_class" in sql:
            rows = [[name, n, n, n] for name, n in classes.items()]
            return ["hand_class", "decisions", "decisions__n", "__hands"], rows
        return frequency_answer({"raise": 800})

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
        return frequency_answer({"raise": 800})

    answer = showdown_range(BTN_3BET, 7, run=run)
    assert answer.sample_size == 4 and answer.enough is False
    assert answer.weights == {} and answer.classes == {}
    # A hand class is dealt, so its gate is a count and stays the constant (ADR-076).
    assert answer.min_n == MIN_N
    # The count still tells the caller how little there was, and of what.
    assert answer.decisions_at_node == 800 and answer.covers == 0.005


def test_the_showdown_query_only_counts_revealed_hands() -> None:
    seen: list[str] = []

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        seen.append(sql)
        if is_frequencies_query(sql):
            return frequency_answer({})
        return ["hand_class", "decisions", "decisions__n", "__hands"], []

    showdown_range(BTN_3BET, 7, run=run)
    assert any("hand_class !=" in sql for sql in seen), seen
