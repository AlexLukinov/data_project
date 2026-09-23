"""A `board_texture` tag is a registry value, looked up across the texture dimensions (ADR-078,
ADR-082). These pin what makes that lookup safe: no value is declared twice, two tags from one
dimension are refused rather than silently matching nothing, a runout tag reaches its street's
dimension, and the retired code is gone from the registry rather than redefined (ADR-075).

The classification itself is not re-implemented here: the fixture both suites parse is run
through the dbt macros in `tests/integration/test_board_texture_fixture.py`. What this file
checks about the fixture is its shape against the registry -- every tag is a value of the
dimension at the same index of the fixture's `dimensions` list.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from analysis.pool.node_filter import TEXTURE_DIMENSIONS, node_filter
from analysis.pool.nodes import NodeKey
from stats.ast import All, Leaf
from stats.errors import RegistryError
from stats.registry import registry

FIXTURE = Path(__file__).with_name("fixtures") / "board_texture.json"


def _fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def _key(street: str, tags: list[str]) -> NodeKey:
    return NodeKey.model_validate({"hero_position": "CO", "street": street, "board_texture": tags})


def _leaves(key: NodeKey) -> dict[str, Any]:
    node = node_filter(key)
    assert isinstance(node, All)
    out: dict[str, Any] = {}
    for leaf in node.all:
        assert isinstance(leaf, Leaf)
        out[leaf.dim] = leaf.value
    return out


def test_no_value_is_declared_by_two_texture_dimensions() -> None:
    """`_texture_leaf` takes the first dimension holding a value; a second is unreachable."""
    reg = registry()
    owner: dict[str, str] = {}
    for code in TEXTURE_DIMENSIONS:
        for value in reg.dimension(code).values:
            if value == "":
                continue  # every board dimension declares '' for "before this street"
            assert value not in owner, f"{value!r} is a value of both {owner[value]} and {code}"
            owner[value] = code


def test_every_texture_dimension_is_an_enum_on_decisions() -> None:
    reg = registry()
    for code in TEXTURE_DIMENSIONS:
        dim = reg.dimension(code)
        assert dim.type == "enum" and "decisions" in dim.tables, code


def test_two_tags_from_one_dimension_are_refused_not_zero_rows() -> None:
    key = _key("flop", ["monotone", "rainbow"])
    with pytest.raises(RegistryError) as excinfo:
        node_filter(key)
    message = str(excinfo.value)
    assert message.startswith("board_texture: ")
    assert "'monotone'" in message and "'rainbow'" in message and "'flop_suitedness'" in message


def test_a_tag_of_a_street_the_node_has_not_reached_is_refused() -> None:
    """`turn_change` is '' on a flop row: the filter would match nothing and say nothing."""
    with pytest.raises(RegistryError, match=r"'turn_blank' is a turn_change value.*on the flop"):
        node_filter(_key("flop", ["two_tone", "turn_blank"]))
    with pytest.raises(RegistryError, match=r"'river_pair' is a river_change value.*on the turn"):
        node_filter(_key("turn", ["river_pair"]))
    with pytest.raises(RegistryError, match=r"'rainbow' is a flop_suitedness value.*preflop"):
        node_filter(_key("preflop", ["rainbow"]))


def test_the_same_tag_twice_is_one_leaf() -> None:
    node = node_filter(_key("flop", ["rainbow", "rainbow"]))
    assert isinstance(node, All)
    assert (
        sum(1 for leaf in node.all if isinstance(leaf, Leaf) and leaf.dim == "flop_suitedness") == 1
    )


def test_a_runout_tag_reaches_its_street_dimension() -> None:
    """The node the plan asks for: ace-high two-tone flop, blank turn (H.2)."""
    where = _leaves(_key("turn", ["ace", "two_tone", "turn_blank"]))
    assert where["flop_high_card_class"] == "ace"
    assert where["flop_suitedness"] == "two_tone"
    assert where["turn_change"] == "turn_blank"
    assert _leaves(_key("river", ["oesd", "river_flush"]))["river_change"] == "river_flush"
    assert _leaves(_key("river", ["oesd", "river_flush"]))["flop_connectivity"] == "oesd"


def test_the_raw_high_card_rank_is_still_a_tag() -> None:
    assert _leaves(_key("flop", ["A"]))["flop_high_card"] == "A"


def test_the_retired_code_and_its_lost_value_are_refused() -> None:
    """ADR-075: a new code, not a redefinition -- `flop_connectedness` fails loudly everywhere."""
    reg = registry()
    with pytest.raises(RegistryError, match="unknown dimension 'flop_connectedness'"):
        reg.dimension("flop_connectedness")
    with pytest.raises(RegistryError, match="unknown dimension 'flop_connectedness'"):
        reg.check_node(Leaf(dim="flop_connectedness", op="eq", value="connected"), "decisions")
    with pytest.raises(RegistryError, match="unknown board texture 'semi_connected'"):
        node_filter(_key("flop", ["semi_connected"]))


def test_fixture_tags_are_registry_values_in_hierarchy_order() -> None:
    """Each tag of a fixture board is a value of the dimension at the same position."""
    fixture = _fixture()
    dims = [registry().dimension(code) for code in fixture["dimensions"]]
    assert [d.code for d in dims] == [c for c in TEXTURE_DIMENSIONS if c != "flop_high_card"]
    street_of_length = {0: "preflop", 4: "flop", 5: "turn", 6: "river"}
    for case in fixture["boards"]:
        tags = case["tags"]
        assert len(tags) in street_of_length, case["board"]
        for dim, tag in zip(dims, tags, strict=False):
            assert tag in dim.values, f"{case['board']}: {tag!r} is not a value of {dim.code}"
        node = node_filter(_key(street_of_length[len(tags)], tags))
        assert isinstance(node, All)


def test_fixture_covers_every_value_of_every_dimension() -> None:
    """A truncated fixture would pass both suites silently; this is what says it is whole."""
    fixture = _fixture()
    seen = {tag for case in fixture["boards"] for tag in case["tags"]}
    for code in fixture["dimensions"]:
        missing = [v for v in registry().dimension(code).values if v and v not in seen]
        assert not missing, f"{code}: no fixture board is tagged {missing}"


def test_fixture_precedence_lists_are_the_registry_values_minus_blank_before() -> None:
    fixture = _fixture()
    reg = registry()
    for code, order in fixture["precedence"].items():
        assert order == [v for v in reg.dimension(code).values if v != ""]
