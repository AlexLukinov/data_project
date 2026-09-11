"""Made-hand classification: against the fixture the TypeScript suite parses too, and by hand.

The fixture is the load-bearing test. `marts.decisions.made_hand` is written by this module and
the Range Lab buckets the same concept in the browser with `classifyMadeHand`; if the two drift,
a hand sits in one class in the mart and another on screen and nothing else notices. Same
pattern as `NodeKey` (ADR-028, ADR-031): one file, both suites.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from core.classify import (
    MADE_HAND_CLASSES,
    UNKNOWN,
    classify_made_hand,
    made_hand_of,
)

FIXTURE = Path(__file__).with_name("fixtures") / "made_hands.json"


def _cases() -> list[dict[str, Any]]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]  # type: ignore[no-any-return]


def _case_id(case: dict[str, Any]) -> str:
    return case.get("note") or f"{''.join(case['hole'])} on {''.join(case['board'])}"


@pytest.mark.parametrize("case", _cases(), ids=_case_id)
def test_agrees_with_the_typescript_reference(case: dict[str, Any]) -> None:
    assert made_hand_of(case["hole"], case["board"]) == case["made"]


def test_the_fixture_covers_every_class() -> None:
    """A fixture that exercised twelve of seventeen classes would pass while hiding five."""
    assert {c["made"] for c in _cases()} == set(MADE_HAND_CLASSES)


@pytest.mark.parametrize(
    ("hole", "board", "expected"),
    [
        (["Ah", "Kd"], ["Ac", "7c", "2s"], "top_pair"),
        (["Ah", "7d"], ["Kc", "7c", "2s"], "second_pair"),
        (["Ah", "2d"], ["Kc", "7c", "2s"], "third_pair"),
        (["Ah", "2d"], ["Kc", "9c", "7s", "2h"], "weak_pair"),
        (["Ah", "Ad"], ["Kc", "9c", "7s"], "overpair"),
        (["2h", "2d"], ["Kc", "9c", "7s"], "under_pair"),
        (["7h", "7d"], ["7c", "2d", "3s"], "set"),
        (["Ah", "7d"], ["7c", "7s", "3s"], "trips"),
        (["Ah", "Kh"], ["Ad", "Kd", "2c"], "two_pair"),
        (["Ah", "5d"], ["Kc", "9c", "7s"], "ace_high"),
        (["Kh", "5d"], ["Qc", "9c", "7s"], "king_high"),
        (["8h", "5d"], ["Qc", "9c", "7s"], "no_pair"),
    ],
)
def test_classes_by_hand(hole: list[str], board: list[str], expected: str) -> None:
    assert made_hand_of(hole, board) == expected


def test_a_board_that_plays_does_not_promote_the_hole_cards() -> None:
    """The class is relative to the board: a straight nobody improved is not *your* straight."""
    assert made_hand_of(["2c", "3d"], ["7h", "6s", "5d", "4c", "8h"]) == "no_pair"
    assert made_hand_of(["9c", "8d"], ["7h", "6s", "5d"]) == "straight"


def test_holding_the_ace_of_a_board_flush_counts_but_a_dead_hand_does_not() -> None:
    """Same category as the board, so only a better RANK promotes the hole cards.

    The board is five hearts, so it already plays a flush for everyone. Holding the ace of
    them is a better flush and reads as one; holding two blanks is not, and reads as the
    nothing it is.
    """
    board = ["Kh", "Qh", "8h", "3h", "2h"]
    assert made_hand_of(["Ah", "5d"], board) == "flush"
    assert made_hand_of(["7c", "5d"], board) == "no_pair"


def test_unknown_where_the_question_cannot_be_asked() -> None:
    """Not shown, no board yet, and not hold'em are all `UNKNOWN`, never a class."""
    assert made_hand_of([], ["Ac", "7c", "2s"]) == UNKNOWN
    assert made_hand_of(["Ah", "Kd"], []) == UNKNOWN
    assert made_hand_of(["Ah", "Kd", "Qd", "Jd"], ["Ac", "7c", "2s"]) == UNKNOWN


def test_a_malformed_board_is_loud() -> None:
    with pytest.raises(ValueError, match="3 to 5 cards"):
        classify_made_hand((0, 1), [2, 3])
