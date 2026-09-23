"""The ADR-078 half of a node's predicate: the line across streets, the bet in front by its
registry bucket, the pot's shape -- and the texture contradiction the texture section refuses.

`tests/test_node_filter.py` reads the single-street predicate back as a sentence; this file
does the same for the fields plan H.1 added, with the river barrel node of 2026-09-22 as the
key that has to be expressible (`line_so_far='r/b/b/'`).
"""

from __future__ import annotations

from typing import Any

import pytest

from analysis.pool.node_filter import OPEN_ENDED, node_filter
from analysis.pool.nodes import NodeKey
from stats.ast import All, Leaf
from stats.checks import check_leaf
from stats.errors import RegistryError
from stats.registry import Registry, registry


def _key(**fields: Any) -> NodeKey:
    return NodeKey.model_validate(fields)


def _step(position: str, action: str, **sizes: float) -> dict[str, Any]:
    return {"position": position, "action": action, **sizes}


def _leaves(key: NodeKey, reg: Registry | None = None) -> dict[str, Any]:
    node = node_filter(key, reg)
    assert isinstance(node, All)
    out: dict[str, Any] = {}
    for leaf in node.all:
        assert isinstance(leaf, Leaf)
        out[leaf.dim] = leaf.value
    return out


BARREL = _key(
    hero_position="BTN",
    villain_position="BB",
    street="river",
    line_so_far="r/b/b/",
    pot_type="srp",
    action_sequence=[_step("BB", "check"), _step("BTN", "bet", size_pct=0.66)],
)
"""The river node of ADR-078: opened, bet the flop, bet the turn, and checked to on the river."""

CHECK_RAISE = _key(
    hero_position="BB",
    villain_position="CO",
    street="flop",
    line_so_far="c/x",
    size_bucket="mid",
    pot_type="srp",
    action_sequence=[
        _step("BB", "check"),
        _step("CO", "bet", size_pct=0.5),
        _step("BB", "raise", size_pct=3),
    ],
)
"""Called preflop, checked, and is raising a half-pot c-bet: every new field set at once."""


def test_a_line_across_streets_replaces_this_street_s_line() -> None:
    """`'r/b/b/'` says what happened on every street; `street_line` would repeat its tail."""
    where = _leaves(BARREL)
    assert where["line_so_far"] == "r/b/b/"
    assert "street_line" not in where and "preflop_line" not in where
    assert (where["street"], where["facing"], where["is_ip"]) == ("river", "none", 1)
    assert where["pot_type"] == "srp"


def test_a_turn_line_carries_a_flop_hero_never_acted_on() -> None:
    """`'c/x-c/'`: called preflop, checked and called the flop, first to act on the turn."""
    lead = _key(
        hero_position="BB",
        villain_position="CO",
        street="turn",
        line_so_far="c/x-c/",
        action_sequence=[_step("BB", "bet", size_pct=0.5)],
    )
    where = _leaves(lead)
    assert where["line_so_far"] == "c/x-c/" and "street_line" not in where
    assert (where["facing"], where["is_ip"]) == ("none", 0)


def test_without_a_line_the_predicate_is_the_single_street_one_it_always_was() -> None:
    single = _key(**{**BARREL.model_dump(), "line_so_far": None})
    where = _leaves(single)
    assert where["street_line"] == "" and "line_so_far" not in where


def test_a_size_bucket_is_the_registry_s_bucket_never_a_boundary_of_its_own() -> None:
    """The key says `mid`; the registry says what `mid` is. No number is written here."""
    buckets = registry().dimension("facing_size_pct").buckets
    where = _leaves(CHECK_RAISE)
    assert where["facing_size_pct"] == list(buckets["mid"])
    assert where["facing"] == "bet" and where["line_so_far"] == "c/x"
    overbet = _leaves(_key(**{**CHECK_RAISE.model_dump(), "size_bucket": "overbet"}))
    assert overbet["facing_size_pct"] == [buckets["overbet"][0], OPEN_ENDED]


def test_a_bucket_the_registry_no_longer_has_is_refused_not_emptied() -> None:
    reg = registry()
    faced = reg.dimension("facing_size_pct")
    without_mid = faced.model_copy(
        update={"buckets": {k: v for k, v in faced.buckets.items() if k != "mid"}}
    )
    renamed = Registry(
        dimensions={**reg.dimensions, "facing_size_pct": without_mid}, stats=reg.stats
    )
    with pytest.raises(RegistryError, match="unknown facing_size_pct bucket 'mid'"):
        node_filter(CHECK_RAISE, renamed)


def test_the_pot_type_is_its_own_leaf_and_absent_when_unset() -> None:
    assert _leaves(_key(**{**BARREL.model_dump(), "pot_type": "3bet"}))["pot_type"] == "3bet"
    assert "pot_type" not in _leaves(_key(**{**BARREL.model_dump(), "pot_type": None}))


def test_two_texture_tags_from_one_dimension_are_refused_not_zero_rows() -> None:
    """The texture section's check: `monotone` and `rainbow` cannot both be true of one flop."""
    key = _key(hero_position="CO", street="flop", board_texture=["monotone", "rainbow"])
    with pytest.raises(RegistryError, match=r"board_texture: 'monotone' and 'rainbow'"):
        node_filter(key)


def test_every_new_leaf_is_a_real_column_the_compiler_accepts() -> None:
    reg = registry()
    for key in (BARREL, CHECK_RAISE):
        node = node_filter(key)
        assert isinstance(node, All)
        for leaf in node.all:
            assert isinstance(leaf, Leaf)
            check_leaf(leaf, reg.dimensions, "decisions", "node")
