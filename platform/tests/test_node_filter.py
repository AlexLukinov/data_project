"""A node is a predicate over `decisions` (ADR-028). These tests read the predicate back as a
sentence: if the filter says something a player would not, it is wrong.

The last step of a key is hero's own action — the thing the pool is asked about — so it must
never appear in the filter, which is what the first test pins down.
"""

from __future__ import annotations

from typing import Any

import pytest

from analysis.pool.node_filter import node_filter
from analysis.pool.nodes import NodeKey
from stats.ast import All, Leaf
from stats.checks import check_leaf
from stats.errors import RegistryError
from stats.registry import registry


def _key(**fields: Any) -> NodeKey:
    return NodeKey.model_validate(fields)


def _step(position: str, action: str, **sizes: float) -> dict[str, Any]:
    return {"position": position, "action": action, **sizes}


def _leaves(key: NodeKey) -> dict[str, Any]:
    node = node_filter(key)
    assert isinstance(node, All)
    out: dict[str, Any] = {}
    for leaf in node.all:
        assert isinstance(leaf, Leaf)
        out[leaf.dim] = leaf.value
    return out


UTG_RFI = _key(hero_position="UTG", action_sequence=[_step("UTG", "raise", size_bb=3)])
BTN_3BET = _key(
    hero_position="BTN",
    villain_position="UTG",
    stake="NL50",
    action_sequence=[_step("UTG", "raise", size_bb=3), _step("BTN", "raise", size_bb=9)],
)
BB_DEFEND = _key(
    hero_position="BB",
    villain_position="CO",
    action_sequence=[_step("CO", "raise", size_bb=2.5), _step("BB", "call")],
)


def test_an_open_is_a_seat_facing_nothing() -> None:
    where = _leaves(UTG_RFI)
    assert where["position"] == "UTG"
    assert where["street"] == "preflop"
    assert where["facing"] == "none"
    assert where["preflop_line"] == ""  # hero has not acted yet at the node
    assert where["players_dealt_in"] == 6


def test_the_last_step_is_the_question_not_the_filter() -> None:
    """`UTG RFI` filters "UTG facing nothing", not "UTG raised": the raise is the answer."""
    assert "action" not in _leaves(UTG_RFI)
    assert "action" not in _leaves(BTN_3BET)
    assert "raise_to_bb" not in _leaves(UTG_RFI)
    # Nor is hero's own size: a size is a filter only when the key names the bucket of the
    # bet *in front* (ADR-078) -- `tests/test_node_filter_situation.py`.
    assert "size_pct" not in _leaves(BTN_3BET) and "facing_size_pct" not in _leaves(BTN_3BET)


def test_a_three_bet_faces_one_raise_from_the_named_seat() -> None:
    where = _leaves(BTN_3BET)
    assert (where["position"], where["facing"]) == ("BTN", "raise")
    assert where["last_raiser_position"] == "UTG"
    assert where["stake_level"] == "NL50"


def test_a_defence_is_the_same_shape_from_the_other_side() -> None:
    where = _leaves(BB_DEFEND)
    assert (where["position"], where["facing"]) == ("BB", "raise")
    assert where["last_raiser_position"] == "CO"


def test_facing_counts_the_raises_in_front() -> None:
    four_bet = _key(
        hero_position="UTG",
        action_sequence=[
            _step("UTG", "raise", size_bb=3),
            _step("BTN", "raise", size_bb=9),
            _step("UTG", "raise", size_bb=22),
        ],
    )
    where = _leaves(four_bet)
    assert where["facing"] == "3bet"
    assert where["preflop_line"] == "r"  # hero opened, and is now answering the 3-bet


def test_a_limped_pot_is_not_an_unopened_one() -> None:
    iso = _key(
        hero_position="BTN",
        action_sequence=[_step("HJ", "limp"), _step("BTN", "raise", size_bb=5)],
    )
    assert _leaves(iso)["facing"] == "limp"


def test_a_postflop_node_uses_this_street_s_line() -> None:
    cbet = _key(
        hero_position="CO",
        villain_position="BB",
        street="flop",
        action_sequence=[_step("BB", "check"), _step("CO", "bet", size_pct=0.33)],
    )
    where = _leaves(cbet)
    assert where["street"] == "flop"
    assert where["facing"] == "none"
    assert where["street_line"] == ""
    assert "preflop_line" not in where


def test_facing_a_bet_then_a_raise_postflop() -> None:
    versus_raise = _key(
        hero_position="CO",
        street="turn",
        action_sequence=[
            _step("CO", "bet", size_pct=0.5),
            _step("BB", "raise", size_pct=1.0),
            _step("CO", "call"),
        ],
    )
    where = _leaves(versus_raise)
    assert where["facing"] == "raise"
    assert where["street_line"] == "b"


def test_the_effective_stack_matches_a_registry_bucket_not_a_float() -> None:
    """`eff_stack_bb` is a Float32 column: an equality on 100 would match almost nothing."""
    assert _leaves(UTG_RFI)["eff_stack_bb"] == [75.0, 125.0]
    assert _leaves(_key(hero_position="BTN", eff_stack_bb=30))["eff_stack_bb"] == [0.0, 40.0]


def test_board_texture_tags_are_registry_values() -> None:
    where = _leaves(
        _key(
            hero_position="CO",
            street="flop",
            board_texture=["two_tone", "unpaired"],
            action_sequence=[_step("CO", "bet", size_pct=0.33)],
        )
    )
    assert where["flop_suitedness"] == "two_tone"
    assert where["flop_pairing"] == "unpaired"


def test_an_unknown_texture_is_refused_with_what_is_on_offer() -> None:
    key = _key(hero_position="CO", street="flop", board_texture=["wet"])
    with pytest.raises(RegistryError, match="unknown board texture 'wet'"):
        node_filter(key)


def test_every_leaf_the_compiler_would_see_is_a_real_column() -> None:
    """The filter must survive the same check the report compiler runs on every leaf."""
    reg = registry()
    for key in (UTG_RFI, BTN_3BET, BB_DEFEND):
        node = node_filter(key)
        assert isinstance(node, All)
        for leaf in node.all:
            assert isinstance(leaf, Leaf)
            check_leaf(leaf, reg.dimensions, "decisions", "node")


def test_a_postflop_villain_becomes_position_when_it_cannot_be_a_column() -> None:
    """A seat that only called cannot be named by `last_raiser_position` or `opener_position`.

    Naming it anyway would filter on a column that means something else and the node would come
    back empty — which is exactly how this was found, on the replayer's turn nodes.
    """
    turn = _key(
        hero_position="BB",
        villain_position="CO",
        street="turn",
        action_sequence=[_step("BB", "bet", size_pct=0.5)],
    )
    where = _leaves(turn)
    assert "last_raiser_position" not in where and "opener_position" not in where
    assert where["is_ip"] == 0  # the BB acts before the CO after the flop
    assert where["street_line"] == ""

    from_the_button = _key(
        hero_position="BTN",
        villain_position="BB",
        street="turn",
        action_sequence=[_step("BTN", "bet", size_pct=0.5)],
    )
    assert _leaves(from_the_button)["is_ip"] == 1


def test_a_squeeze_still_faces_the_seat_that_raised() -> None:
    squeeze = _key(
        hero_position="BB",
        villain_position="UTG",
        action_sequence=[
            _step("UTG", "raise", size_bb=3),
            _step("CO", "call"),
            _step("BB", "raise", size_bb=12),
        ],
    )
    where = _leaves(squeeze)
    assert where["last_raiser_position"] == "UTG"
    assert where["facing"] == "raise"


def test_the_opener_is_named_when_someone_else_has_raised_since() -> None:
    """Cold-4-betting UTG: the seat hero cares about opened, but is not the last raiser."""
    cold_four_bet = _key(
        hero_position="BB",
        villain_position="UTG",
        action_sequence=[
            _step("UTG", "raise", size_bb=3),
            _step("BTN", "raise", size_bb=9),
            _step("BB", "raise", size_bb=24),
        ],
    )
    where = _leaves(cold_four_bet)
    assert where["opener_position"] == "UTG"
    assert "last_raiser_position" not in where
    assert where["facing"] == "3bet"
