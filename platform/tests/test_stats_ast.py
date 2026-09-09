"""The filter / expression tree accepts exactly the grammar of ADR-022 and nothing else.

Shape only: dimension names are not resolved here (that is `stats.checks`), so these tests
run without loading the registry.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from stats.ast import (
    Add,
    All,
    AnyOf,
    CountIf,
    Leaf,
    Not,
    is_additive,
    leaves,
    parse_expr,
    parse_node,
    terms,
)


def test_leaf_with_scalar_and_list_values() -> None:
    assert parse_node({"dim": "street", "op": "eq", "value": "flop"}) == Leaf(
        dim="street", op="eq", value="flop"
    )
    node = parse_node({"dim": "position", "op": "in", "value": ["CO", "BTN"]})
    assert isinstance(node, Leaf) and node.value == ["CO", "BTN"]


def test_between_takes_exactly_two_bounds() -> None:
    parse_node({"dim": "spr", "op": "between", "value": [3, 6]})
    with pytest.raises(ValidationError, match="exactly"):
        parse_node({"dim": "spr", "op": "between", "value": [3, 6, 9]})


@pytest.mark.parametrize(
    "raw",
    [
        {"dim": "spr", "op": "eq", "value": [3]},  # scalar op, list value
        {"dim": "spr", "op": "in", "value": 3},  # list op, scalar value
        {"dim": "spr", "op": "in", "value": []},  # nothing to be in
        {"dim": "spr", "op": "matches", "value": "x"},  # unknown op
        {"dim": "spr", "op": "eq", "value": 1, "extra": 1},  # unknown key
        {"dim": "Spr", "op": "eq", "value": 1},  # code pattern
        {"all": [], "any": []},  # two combinators in one node
        {"not": {"dim": "spr", "op": "eq"}},  # missing value inside not
        "spr = 1",  # a text DSL is exactly what ADR-022 rejects
    ],
)
def test_malformed_nodes_are_rejected(raw: object) -> None:
    with pytest.raises(ValidationError):
        parse_node(raw)


def test_combinators_nest_and_not_uses_its_alias() -> None:
    node = parse_node(
        {
            "all": [
                {"dim": "street", "op": "eq", "value": "flop"},
                {
                    "any": [
                        {"dim": "spr", "op": "lt", "value": 3},
                        {"dim": "is_ip", "op": "eq", "value": 1},
                    ]
                },
                {"not": {"dim": "action", "op": "eq", "value": "fold"}},
            ]
        }
    )
    assert isinstance(node, All)
    assert isinstance(node.all[1], AnyOf)
    assert isinstance(node.all[2], Not)
    assert [leaf.dim for leaf in leaves(node)] == ["street", "spr", "is_ip", "action"]
    assert node.model_dump(by_alias=True)["all"][2] == {
        "not": {"dim": "action", "op": "eq", "value": "fold"}
    }


def test_empty_all_means_every_row() -> None:
    node = parse_node({"all": []})
    assert isinstance(node, All)
    assert list(leaves(node)) == []


def test_empty_any_is_rejected() -> None:
    with pytest.raises(ValidationError):
        parse_node({"any": []})


def test_expressions() -> None:
    expr = parse_expr(
        {
            "div": [
                {
                    "add": [
                        {"countIf": {"dim": "action", "op": "eq", "value": "bet"}},
                        {"count": True},
                    ]
                },
                {"sum": "net_won_bb"},
            ]
        }
    )
    kinds = [type(t).__name__ for t in terms(expr)]
    assert kinds == ["CountIf", "Count", "Sum"]
    assert not is_additive(expr)
    assert is_additive(parse_expr({"countIf": {"all": []}}))


@pytest.mark.parametrize(
    "raw",
    [
        {"count": False},
        {"add": [{"count": True}]},  # arithmetic needs two operands
        {"avg": "spr"},  # unknown function
        {"sum": "net won"},  # code pattern
        {"countIf": "spr > 3"},  # text where a node belongs
    ],
)
def test_malformed_expressions_are_rejected(raw: object) -> None:
    with pytest.raises(ValidationError):
        parse_expr(raw)


def test_models_are_immutable() -> None:
    leaf = Leaf(dim="spr", op="eq", value=1)
    with pytest.raises(ValidationError):
        leaf.op = "ne"  # type: ignore[misc]
    assert isinstance(Add(add=[CountIf(count_if=leaf), CountIf(count_if=leaf)]), Add)
