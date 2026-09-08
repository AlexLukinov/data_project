"""Validation tests — proving the checks actually fail on broken hands.

A validator that never rejects anything is worse than no validator, because it creates false
confidence. Each test here corrupts a known-good hand in one specific way and asserts the
right code fires.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from core.enums import ActionType, Site
from core.models import PotWinner
from core.validation import Severity as Sev
from core.validation import validate
from parser.registry import parse_file


@pytest.fixture
def good_hand(stars_cash_text: str):
    return next(iter(parse_file(stars_cash_text, Site.POKERSTARS)))


def test_good_hand_passes(good_hand) -> None:
    result = validate(good_hand)
    assert result.ok
    assert result.summary() == "ok"


def test_mis_parsed_amount_breaks_the_pot(good_hand) -> None:
    """The canonical failure: one amount read wrong, everything else looks fine."""
    raise_action = next(a for a in good_hand.actions if a.action_type is ActionType.RAISE)
    raise_action.amount += Decimal("1.00")
    result = validate(good_hand)
    assert not result.ok
    assert [f.code for f in result.errors] == ["pot_mismatch"]


def test_missing_rake_breaks_the_pot(good_hand) -> None:
    good_hand.rake = Decimal("0")
    result = validate(good_hand)
    assert not result.ok
    assert "pot_mismatch" in result.summary()


def test_cent_of_slack_is_tolerated(good_hand) -> None:
    """Sites round rake to the cent; a whole cent of slack absorbs that without hiding a
    real mis-parse, which is off by a bet rather than by a cent."""
    good_hand.rake += Decimal("0.01")
    assert validate(good_hand).ok


def test_duplicate_card_is_an_error(good_hand) -> None:
    hero = good_hand.hero
    assert hero is not None
    hero.hole_cards = (good_hand.board[0], "Kd")  # reuse a board card
    result = validate(good_hand)
    assert not result.ok
    assert any(f.code == "duplicate_card" for f in result.errors)


def test_unordered_actions_are_an_error(good_hand) -> None:
    good_hand.actions[0].action_index = 999
    result = validate(good_hand)
    assert not result.ok
    assert any(f.code == "actions_unordered" for f in result.errors)


def test_street_gap_is_an_error(good_hand) -> None:
    """A truncated file that lost the flop but kept the turn must not import silently."""
    from core.enums import Street

    for action in good_hand.actions:
        if action.street is Street.FLOP:
            action.street = Street.PREFLOP
    result = validate(good_hand)
    assert not result.ok
    assert any(f.code == "street_gap" for f in result.errors)


def test_too_few_players_is_an_error(good_hand) -> None:
    good_hand.players = good_hand.players[:1]
    result = validate(good_hand)
    assert not result.ok
    assert any(f.code == "too_few_players" for f in result.errors)


def test_net_won_mismatch_is_only_a_warning(good_hand) -> None:
    """A wrong `net_won` is recoverable (we recompute it); a wrong pot is not."""
    good_hand.players[0].net_won += Decimal("5.00")
    result = validate(good_hand)
    assert result.ok  # still storable
    assert any(f.severity is Sev.WARNING for f in result.findings)


def test_extra_winner_breaks_reconciliation(good_hand) -> None:
    good_hand.pot_winners.append(PotWinner(pot_index=0, seat=2, amount_won=Decimal("1.00")))
    result = validate(good_hand)
    assert not result.ok
