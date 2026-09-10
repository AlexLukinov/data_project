"""`NodeKey` against the fixture both test suites parse (ADR-028), and against the registry."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from analysis.pool.nodes import POSITIONS, NodeKey
from stats.registry import registry

FIXTURE = Path(__file__).with_name("fixtures") / "nodes.json"


def _fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_positions_are_the_registry_vocabulary_without_unknown() -> None:
    position = registry().dimension("position")
    assert list(POSITIONS) == [v for v in position.values if v != "UNKNOWN"]
    assert _fixture()["positions"] == list(POSITIONS)


@pytest.mark.parametrize("case", _fixture()["valid"], ids=lambda c: c["name"])
def test_valid_nodes_validate_to_their_canonical_form(case: dict[str, Any]) -> None:
    key = NodeKey.model_validate(case["input"])
    assert key.canonical() == case["canonical"]
    # The canonical form is a fixed point: storing and re-reading changes nothing.
    assert NodeKey.model_validate(case["canonical"]).canonical() == case["canonical"]


@pytest.mark.parametrize("case", _fixture()["invalid"], ids=lambda c: c["reason"])
def test_invalid_nodes_are_rejected(case: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        NodeKey.model_validate(case["input"])


def test_canonical_json_is_the_same_whatever_the_key_order() -> None:
    a = NodeKey.model_validate({"hero_position": "CO", "street": "flop", "stake": "NL2"})
    b = NodeKey.model_validate({"stake": "NL2", "street": "flop", "hero_position": "CO"})
    assert a.canonical() == b.canonical()
