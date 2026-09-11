"""Exact all-in equity: against an independent enumeration, side-pot layering, and the memo.

The first test is the one that matters. `fixtures/equity_spots.json` was generated in F.2 by
`gen_equity_spots.py` with **treys** — a different evaluator, a different code base, brute-force
enumeration — to check the TypeScript engine. Every spot in it whose two sides are single
combos is re-used here unchanged, so this engine is pinned to a number nothing in this repo
produced. Exact means exact: the tolerance is 1e-9, not a sampling band.

Spots carrying `dead` cards are skipped rather than approximated: an all-in has no dead cards
by construction (see `core.cards.remaining_deck` for why a revealed muck is not one), so
`equity()` has no parameter for them and pretending otherwise would test a fiction.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from core.cards import card_id
from core.equity import (
    cache_size,
    canonical_key,
    equity,
    merge_layers,
    pot_layers,
    pot_shares,
)

SPOTS = Path(__file__).parents[1] / "web/packages/poker-core/fixtures/equity_spots.json"
_COMBO = re.compile(r"^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$")


def _hole(text: str) -> tuple[int, int]:
    a, b = text.split() if " " in text else (text[:2], text[2:])
    return card_id(a), card_id(b)


def _cards(text: str) -> list[int]:
    return [card_id(c) for c in text.split()] if text else []


def _independent_spots() -> list[dict[str, Any]]:
    spots = json.loads(SPOTS.read_text(encoding="utf-8"))["spots"]
    return [
        s for s in spots if _COMBO.match(s["hero"]) and _COMBO.match(s["villain"]) and not s["dead"]
    ]


@pytest.mark.parametrize("spot", _independent_spots(), ids=lambda s: s["name"])
def test_matches_the_independent_treys_enumeration(spot: dict[str, Any]) -> None:
    got = equity([_hole(spot["hero"]), _hole(spot["villain"])], _cards(spot["board"]))
    assert got[0] == pytest.approx(spot["heroEquity"], abs=1e-9)
    assert sum(got) == pytest.approx(1.0)


def test_the_independent_set_reaches_preflop_where_enumeration_is_biggest() -> None:
    """A fixture of rivers only would never exercise the 1.7M-runout path at all."""
    assert sum(1 for s in _independent_spots() if not s["board"]) >= 3


def test_a_finished_board_is_a_certainty_not_an_estimate() -> None:
    """Nothing to come: equity is 1 and 0, which is why such a hand gets no EV adjustment."""
    got = equity([_hole("Ac Ad"), _hole("Ks Kh")], _cards("Ah 7c 2s 3d 4c"))
    assert got == (1.0, 0.0)


def test_a_split_board_splits_the_equity() -> None:
    """Both play the board: each wins half of every runout, so each is exactly 0.5."""
    got = equity([_hole("2c 3d"), _hole("2h 3s")], _cards("Ah Kh Qc Jd Ts"))
    assert got == (0.5, 0.5)


def test_counted_by_hand_on_the_turn() -> None:
    """44 runouts; hero wins on 9 hearts plus 3 aces plus 3 kings, and on nothing else."""
    hero, villain = _hole("Ah Kh"), _hole("Qs Qd")
    got = equity([hero, villain], _cards("Jh 7h 2c 3d"))
    assert got[0] == pytest.approx(15 / 44, abs=1e-9)


def test_equity_is_symmetric_under_the_player_order() -> None:
    forward = equity([_hole("Ac Ad"), _hole("Ks Kh")], [])
    backward = equity([_hole("Ks Kh"), _hole("Ac Ad")], [])
    assert forward == (backward[1], backward[0])


def test_canonical_key_folds_suit_relabelings_together() -> None:
    """The same matchup in different suits is one calculation, which is what makes it cheap."""
    a, _ = canonical_key([_hole("Ac Ad"), _hole("Ks Kh")], [])
    b, _ = canonical_key([_hole("Ah As"), _hole("Kc Kd")], [])
    assert a == b


def test_canonical_key_keeps_genuinely_different_spots_apart() -> None:
    """Suited and offsuit differ, so relabeling must not collapse them."""
    a, _ = canonical_key([_hole("Ac Kc"), _hole("Qs Qd")], [])
    b, _ = canonical_key([_hole("Ac Kd"), _hole("Qs Qh")], [])
    assert a != b


def test_the_memo_answers_the_second_call_without_enumerating_again() -> None:
    equity([_hole("9c 9d"), _hole("Ts Th")], [])
    before = cache_size()
    equity([_hole("9h 9s"), _hole("Tc Td")], [])
    assert cache_size() == before


def test_pot_layers_merge_when_nobody_new_becomes_eligible() -> None:
    """A folder's dead money makes a level, not a side pot: the same two players win it."""
    # Seats 0 and 1 are all-in for 100; seat 2 folded for 5.
    layers = pot_layers([100.0, 100.0, 5.0], [0, 1])
    assert layers == [(205.0, (0, 1))]


def test_pot_layers_build_a_real_side_pot() -> None:
    """A short stack cannot win what it could not cover."""
    layers = sorted(pot_layers([40.0, 100.0, 100.0], [0, 1, 2]))
    assert layers == [(120.0, (0, 1, 2)), (120.0, (1, 2))]


def test_merge_layers_sums_amounts_and_drops_empty_ones() -> None:
    assert merge_layers([(10.0, (0, 1)), (5.0, (0, 1)), (0.0, (1,))]) == [(15.0, (0, 1))]


def test_the_short_stack_cannot_win_the_side_pot_however_good_its_hand() -> None:
    """The whole reason equity-against-the-field is the wrong model (ADR-018)."""
    short, big, other = _hole("Ac Ad"), _hole("7c 2d"), _hole("7h 2s")
    layers = pot_layers([10.0, 100.0, 100.0], [0, 1, 2])
    shares = pot_shares([short, big, other], _cards("Ah 7d 2c Kd Qs"), layers)
    # The short stack has quad-ish equity and takes the main pot; the side pot is split by the
    # two who covered it, and the short stack's share of it is exactly zero.
    assert shares[0] == pytest.approx(30.0 / 210.0)
    assert shares[1] == pytest.approx(90.0 / 210.0)
    assert shares[2] == pytest.approx(90.0 / 210.0)
    assert sum(shares) == pytest.approx(1.0)


def test_shares_sum_to_one_in_a_three_way_all_in() -> None:
    holes = [_hole("Ac Ad"), _hole("Ks Kh"), _hole("Qc Qd")]
    layers = pot_layers([50.0, 50.0, 50.0], [0, 1, 2])
    assert sum(pot_shares(holes, _cards("2c 7d 9s"), layers)) == pytest.approx(1.0)


def test_no_layers_is_refused_rather_than_answered_with_zero() -> None:
    with pytest.raises(ValueError, match="at least one pot layer"):
        pot_shares([_hole("Ac Ad"), _hole("Ks Kh")], [], [])
