"""PokerStars parser regression tests.

These assert against hands whose money was worked out by hand. When a parser change breaks
one of these, the parser is wrong — not the fixture.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from core.enums import ActionType, GameType, LimitType, Position, Site, Street
from core.validation import validate
from parser.registry import parse, parse_file, split_hands


def _hands(text: str) -> list:
    return list(parse_file(text, Site.POKERSTARS))


def test_split_finds_every_hand(stars_cash_text: str, stars_edge_text: str) -> None:
    assert len(list(split_hands(stars_cash_text, Site.POKERSTARS))) == 2
    assert len(list(split_hands(stars_edge_text, Site.POKERSTARS))) == 4


def test_header_fields(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[0]
    assert hand.site is Site.POKERSTARS
    assert hand.site_hand_id == "245678901234"
    assert hand.game_type is GameType.HOLDEM
    assert hand.limit_type is LimitType.NL
    assert hand.small_blind == Decimal("0.25")
    assert hand.big_blind == Decimal("0.50")
    assert hand.currency == "USD"
    assert hand.max_seats == 6
    assert hand.button_seat == 3
    assert hand.stake_level == "NL50"
    # 10:23:45 ET on 2026-01-15 is 15:23:45 UTC (EST, UTC-5).
    assert hand.played_at_utc.hour == 15
    assert hand.tz_source == "ET"


def test_seats_and_hero(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[0]
    assert len(hand.players) == 6
    hero = hand.hero
    assert hero is not None
    assert hero.screen_name == "Hero"
    assert hero.seat == 1
    assert hero.hole_cards == ("Ac", "Kd")
    assert hero.player_key == "pokerstars:hero"
    assert not hero.is_anonymized


def test_positions_6max(stars_cash_text: str) -> None:
    """Button seat 3 -> BTN=3, SB=4, BB=5, then UTG=6, HJ=1, CO=2."""
    hand = _hands(stars_cash_text)[0]
    by_seat = {p.seat: p.position for p in hand.players}
    assert by_seat == {
        3: Position.BTN,
        4: Position.SB,
        5: Position.BB,
        6: Position.UTG,
        1: Position.HJ,
        2: Position.CO,
    }


def test_raise_amount_is_the_increment_not_the_total(stars_cash_text: str) -> None:
    """`raises $1.00 to $1.50` from a player with nothing in adds $1.50, not $1.00.

    This is the classic parser bug. Pot-math validation is what catches it, but assert it
    directly too so a failure points straight at the cause.
    """
    hand = _hands(stars_cash_text)[0]
    raises = [a for a in hand.actions if a.action_type is ActionType.RAISE]
    assert len(raises) == 1
    assert raises[0].amount == Decimal("1.50")
    assert raises[0].amount_to == Decimal("1.50")


def test_raise_over_a_posted_blind_subtracts_the_blind(stars_edge_text: str) -> None:
    """Heads-up: the button posts the SB, then `raises $0.75 to $1.25` adds only $1.00."""
    hand = _hands(stars_edge_text)[2]
    hero = hand.hero
    assert hero is not None
    raise_action = next(
        a for a in hand.actions if a.action_type is ActionType.RAISE and a.seat == hero.seat
    )
    assert raise_action.amount == Decimal("1.00")
    assert raise_action.amount_to == Decimal("1.25")


def test_uncalled_bet_is_returned(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[0]
    returns = [a for a in hand.actions if a.action_type is ActionType.UNCALLED_RETURN]
    assert len(returns) == 1
    assert returns[0].amount == Decimal("5.50")
    hero = hand.hero
    assert hero is not None
    # 1.50 preflop + 2.00 flop + 5.50 turn - 5.50 returned = 3.50 invested
    assert hero.total_invested == Decimal("3.50")
    assert hero.net_won == Decimal("3.90")  # collected 7.40 - 3.50


def test_board_accumulates_across_streets(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[0]
    assert hand.board == ("Ah", "7c", "2d", "9s")
    assert hand.flop == ("Ah", "7c", "2d")


def test_showdown_hand_records_both_hole_cards(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[1]
    shown = {p.screen_name: p.hole_cards for p in hand.players if p.hole_cards}
    assert shown["Hero"] == ("Ah", "Kd")
    assert shown["CallingStation"] == ("Kc", "Ts")
    assert {p.seat for p in hand.players if p.went_to_showdown} == {1, 3}


def test_side_pot_hand(stars_edge_text: str) -> None:
    """Three-way all-in with different stacks produces a main pot and a side pot."""
    hand = _hands(stars_edge_text)[1]
    assert len(hand.pot_winners) == 2
    assert {w.pot_index for w in hand.pot_winners} == {0, 1}
    assert sum(w.amount_won for w in hand.pot_winners) == Decimal("69.75")
    button_boy = next(p for p in hand.players if p.screen_name == "ButtonBoy")
    assert button_boy.won_hand
    assert button_boy.net_won == Decimal("39.75")  # 69.75 won - 30.00 in


def test_split_pot_awards_both_players(stars_edge_text: str) -> None:
    hand = _hands(stars_edge_text)[2]
    winners = {w.seat: w.amount_won for w in hand.pot_winners}
    assert winners == {1: Decimal("2.63"), 2: Decimal("2.62")}
    assert all(p.won_hand for p in hand.players)


def test_heads_up_button_is_the_small_blind(stars_edge_text: str) -> None:
    """The trap: heads-up has only BTN and BB, and the button acts FIRST preflop."""
    hand = _hands(stars_edge_text)[2]
    by_seat = {p.seat: p.position for p in hand.players}
    assert by_seat == {1: Position.BTN, 2: Position.BB}
    order = {p.seat: p.position_index for p in hand.players}
    assert order == {1: 0, 2: 1}


def test_plo_hand_has_four_hole_cards(stars_edge_text: str) -> None:
    hand = _hands(stars_edge_text)[3]
    assert hand.game_type is GameType.OMAHA
    assert hand.limit_type is LimitType.PL
    assert hand.hole_card_count == 4
    hero = hand.hero
    assert hero is not None
    assert hero.hole_cards == ("Ah", "Kh", "9c", "8c")


def test_street_flags(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[0]
    saw_flop = {p.seat for p in hand.players if p.saw_flop}
    assert saw_flop == {1, 3}
    saw_river = {p.seat for p in hand.players if p.saw_river}
    assert saw_river == set()


@pytest.mark.parametrize("index", range(4))
def test_every_edge_hand_balances(stars_edge_text: str, index: int) -> None:
    """Pot math must reconcile on every hand in the corpus."""
    hand = _hands(stars_edge_text)[index]
    result = validate(hand)
    assert result.ok, result.summary()


def test_every_cash_hand_balances(stars_cash_text: str) -> None:
    for hand in _hands(stars_cash_text):
        result = validate(hand)
        assert result.ok, result.summary()


def test_actions_are_globally_ordered(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[1]
    indices = [a.action_index for a in hand.actions]
    assert indices == sorted(indices)
    assert indices == list(range(len(indices)))
    streets = [a.street for a in hand.actions]
    assert Street.PREFLOP in streets
    assert Street.RIVER in streets


def test_parse_single_hand_entry_point(stars_cash_text: str) -> None:
    """`parse(raw_text, site)` — the ADR-001 interface — works on one hand."""
    chunk = next(iter(split_hands(stars_cash_text, Site.POKERSTARS)))
    hand = parse(chunk, Site.POKERSTARS)
    assert hand.site_hand_id == "245678901234"


def test_allin_runout_counts_as_seeing_every_street(stars_edge_text: str) -> None:
    """Both players in a preflop all-in SEE the flop, turn and river without acting.

    Defining "saw the flop" as "acted on the flop" undercounts WWSF and WTSD on exactly the
    hands where the most money moved — so it is defined as "still live when the flop was
    dealt" instead.
    """
    hand = _hands(stars_edge_text)[0]  # Hero all-in preflop vs MidStack, board runs out
    live = {p.seat for p in hand.players if p.saw_flop}
    assert live == {3, 4}
    assert all(p.saw_river for p in hand.players if p.seat in live)
    assert {p.seat for p in hand.players if p.went_to_showdown} == {3, 4}


def test_folded_preflop_players_did_not_see_the_flop(stars_edge_text: str) -> None:
    hand = _hands(stars_edge_text)[0]
    folded = {p.seat for p in hand.players if p.seat not in (3, 4)}
    assert all(not p.saw_flop for p in hand.players if p.seat in folded)
