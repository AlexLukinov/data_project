"""`NodeKey` against the fixture both test suites parse (ADR-028), and against the registry."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from analysis.pool.nodes import POSITIONS, POT_TYPES, SIZE_BUCKETS, NodeKey
from stats.registry import registry

FIXTURE = Path(__file__).with_name("fixtures") / "nodes.json"


def _fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_positions_are_the_registry_vocabulary_without_unknown() -> None:
    position = registry().dimension("position")
    assert list(POSITIONS) == [v for v in position.values if v != "UNKNOWN"]
    assert _fixture()["positions"] == list(POSITIONS)


def test_pot_types_are_the_registry_vocabulary() -> None:
    assert list(POT_TYPES) == registry().dimension("pot_type").values
    assert _fixture()["pot_types"] == list(POT_TYPES)


def test_size_buckets_are_the_registry_s_faced_size_buckets_by_name() -> None:
    """The names are the key's; the boundaries stay in the registry (ADR-028)."""
    assert list(SIZE_BUCKETS) == list(registry().dimension("facing_size_pct").buckets)
    assert _fixture()["size_buckets"] == list(SIZE_BUCKETS)


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


def test_a_preflop_key_carries_no_line_because_its_sequence_is_the_line() -> None:
    """`''` beside `null` would be two spellings of one situation, and lookup compares spellings."""
    with pytest.raises(ValidationError, match="postflop only"):
        NodeKey.model_validate(
            {
                "hero_position": "CO",
                "line_so_far": "r",
                "action_sequence": [
                    {"position": "CO", "action": "raise", "size_bb": 2.5},
                    {"position": "BTN", "action": "raise", "size_bb": 8},
                    {"position": "CO", "action": "call"},
                ],
            }
        )


def test_a_line_reaches_exactly_the_key_s_street() -> None:
    """`'r/b/'` is a turn line; on the river it is a street short, and the key says which."""
    with pytest.raises(ValidationError, match=r"has 3 street\(s\) but the key is on the river"):
        NodeKey.model_validate({"hero_position": "BTN", "street": "river", "line_so_far": "r/b/"})


def test_a_line_ends_the_way_the_sequence_says() -> None:
    """One account of this street: the sequence says hero bet, the line says hero checked."""
    with pytest.raises(ValidationError, match="one account of a street"):
        NodeKey.model_validate(
            {
                "hero_position": "BB",
                "street": "flop",
                "line_so_far": "c/x",
                "action_sequence": [
                    {"position": "BB", "action": "bet", "size_pct": 0.5},
                    {"position": "CO", "action": "raise", "size_pct": 1},
                    {"position": "BB", "action": "call"},
                ],
            }
        )


def test_a_size_bucket_is_postflop_only() -> None:
    """Preflop the size is a raise-to in blinds on the step; the bucket is a share of the pot."""
    with pytest.raises(ValidationError, match="postflop only"):
        NodeKey.model_validate({"hero_position": "BB", "size_bucket": "small"})


def test_a_key_stored_before_adr_078_reads_back_with_the_three_defaults() -> None:
    """Every `ranges.node_key` and `analyses.node_key` written before H.1 had eight fields."""
    stored = {
        "stake": "",
        "table_size": 6,
        "eff_stack_bb": 100,
        "hero_position": "BB",
        "villain_position": "CO",
        "action_sequence": [
            {"position": "CO", "action": "raise", "size_bb": 2.5, "size_pct": None},
            {"position": "BB", "action": "call", "size_bb": None, "size_pct": None},
        ],
        "street": "preflop",
        "board_texture": [],
    }
    key = NodeKey.model_validate(stored)
    assert (key.line_so_far, key.size_bucket, key.pot_type) == (None, None, None)
    assert key.canonical() == {
        **stored,
        "line_so_far": None,
        "size_bucket": None,
        "pot_type": None,
    }
