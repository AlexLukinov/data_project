"""Parse-time enrichment: when EV applies, what it redistributes, and when it stays out.

The invariant the whole design rests on is `sum(ev_won) == sum(net_won)` for a hand. EV here is
not a new pot invented from equities; it is the pot that was actually awarded, handed out by
expected share instead of by the cards that happened to come. That is what makes an EV win rate
comparable with the real one, and it is what the dbt assertion re-checks on the real corpus.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from core.allin import all_in_spot, enrich, fill_made_hands
from core.enums import (
    ActionType,
    GameType,
    LimitType,
    Position,
    Site,
    Street,
    TableFormat,
)
from core.models import Action, CanonicalHand, HandPlayer, PotWinner

BB = Decimal("1")


def _player(seat: int, cards: str, invested: str, won: str, showdown: bool = True) -> HandPlayer:
    return HandPlayer(
        seat=seat,
        screen_name=f"p{seat}",
        starting_stack=Decimal("100"),
        player_key=f"ggpoker:p{seat}",
        position=Position.BTN if seat == 1 else Position.BB,
        hole_cards=tuple(cards.split()) if cards else (),
        total_invested=Decimal(invested),
        net_won=Decimal(won) - Decimal(invested),
        went_to_showdown=showdown,
        won_hand=Decimal(won) > 0,
    )


def _hand(players: list[HandPlayer], board: str, *, allin: bool = True) -> CanonicalHand:
    actions = [
        Action(
            action_index=i,
            street=Street.PREFLOP,
            seat=p.seat,
            action_type=ActionType.CALL,
            amount=p.total_invested,
            is_allin=allin,
        )
        for i, p in enumerate(players)
    ]
    hand = CanonicalHand(
        site=Site.GGPOKER,
        site_hand_id="h1",
        played_at_utc=datetime(2026, 1, 1, tzinfo=UTC),
        game_type=GameType.HOLDEM,
        limit_type=LimitType.NL,
        table_format=TableFormat.CASH,
        currency="USD",
        small_blind=Decimal("0.5"),
        big_blind=BB,
        max_seats=6,
        button_seat=1,
        players=players,
        actions=actions,
        board=tuple(board.split()) if board else (),
    )
    hand.pot_winners = [
        PotWinner(pot_index=0, seat=p.seat, amount_won=p.net_won + p.total_invested)
        for p in players
        if p.net_won + p.total_invested > 0
    ]
    return hand


def test_a_preflop_all_in_gets_an_ev_that_is_not_the_actual_result() -> None:
    """The acceptance clause of plan E.5, in one test."""
    winner = _player(1, "Ac Ad", "100", "200")
    loser = _player(2, "Ks Kh", "100", "0")
    hand = _hand([winner, loser], "2c 7d 9s Jh 3c")
    enrich(hand)
    assert winner.allin_equity == Decimal("0.812555")
    assert winner.ev_won != winner.net_won
    # 81.2555% of the 200 awarded, less the 100 put in.
    assert winner.ev_won == pytest.approx(Decimal("62.5110"), abs=Decimal("0.0002"))
    assert loser.ev_won == pytest.approx(Decimal("-62.5110"), abs=Decimal("0.0002"))


def test_ev_redistributes_the_pot_and_never_invents_money() -> None:
    players = [_player(1, "Ac Ad", "100", "200"), _player(2, "Ks Kh", "100", "0")]
    hand = _hand(players, "2c 7d 9s Jh 3c")
    enrich(hand)
    assert sum(p.ev_won for p in players) == sum(p.net_won for p in players) == Decimal(0)


def test_dead_money_from_a_folder_is_won_by_the_contenders() -> None:
    """A folder's chips are in the pot; they are just not the folder's to win back."""
    winner = _player(1, "Ac Ad", "100", "205")
    loser = _player(2, "Ks Kh", "100", "0")
    folder = _player(3, "", "5", "0", showdown=False)
    hand = _hand([winner, loser, folder], "2c 7d 9s Jh 3c")
    enrich(hand)
    assert folder.ev_won is None  # not a contender: the actual result already is the EV
    # The two who contested it share the folder's 5 between them, in proportion to equity.
    assert winner.ev_won + loser.ev_won == Decimal("5.0000")
    assert winner.ev_won == pytest.approx(Decimal("66.5738"), abs=Decimal("0.0002"))
    # And the hand still sums to zero once the folder's own loss is counted.
    adjusted = sum((p.ev_won if p.ev_won is not None else p.net_won) for p in hand.players)
    assert adjusted == sum(p.net_won for p in hand.players) == Decimal(0)


def test_no_ev_when_the_board_was_already_complete() -> None:
    """A river call has no variance left, so adjusting it would be noise, not information."""
    players = [_player(1, "Ac Ad", "100", "200"), _player(2, "Ks Kh", "100", "0")]
    hand = _hand(players, "2c 7d 9s Jh 3c")
    for action in hand.actions:
        action.street = Street.RIVER
    enrich(hand)
    assert all(p.ev_won is None for p in players)
    assert all_in_spot(hand) is None


def test_no_ev_without_an_all_in() -> None:
    players = [_player(1, "Ac Ad", "10", "20"), _player(2, "Ks Kh", "10", "0")]
    hand = _hand(players, "2c 7d 9s Jh 3c", allin=False)
    enrich(hand)
    assert all(p.ev_won is None for p in players)


def test_no_ev_when_a_contender_never_showed_its_cards() -> None:
    """Half a matchup is not an equity. The pool has plenty of these."""
    players = [_player(1, "Ac Ad", "100", "200"), _player(2, "", "100", "0")]
    hand = _hand(players, "2c 7d 9s Jh 3c")
    enrich(hand)
    assert all(p.ev_won is None for p in players)


def test_no_ev_when_a_third_hand_reached_showdown_unseen() -> None:
    """Sharing the whole pot between the two that were shown would spend the third's money."""
    players = [
        _player(1, "Ac Ad", "100", "300"),
        _player(2, "Ks Kh", "100", "0"),
        _player(3, "", "100", "0"),
    ]
    hand = _hand(players, "2c 7d 9s Jh 3c")
    enrich(hand)
    assert all(p.ev_won is None for p in players)


@pytest.mark.parametrize(
    ("street", "board"),
    [(Street.PREFLOP, ""), (Street.FLOP, "2c 7d 9s"), (Street.TURN, "2c 7d 9s Jh")],
)
def test_no_ev_when_the_runout_was_never_dealt(street: Street, board: str) -> None:
    """GGPoker settles an all-in on request and deals no more cards — 20% of the pool's.

    The board stops exactly where betting stopped. There was no gamble to take the luck out
    of, so the actual result is the honest answer.
    """
    players = [_player(1, "Ac Ad", "100", "200"), _player(2, "Ks Kh", "100", "0")]
    hand = _hand(players, board)
    for action in hand.actions:
        action.street = street
    enrich(hand)
    assert all_in_spot(hand) is None
    assert all(p.ev_won is None for p in players)


def test_made_hands_are_filled_per_street_and_stop_where_the_board_stops() -> None:
    player = _player(1, "Ac Ad", "10", "0")
    hand = _hand([player], "Ah 7d 2c 3s")
    fill_made_hands(hand)
    assert (player.made_hand_flop, player.made_hand_turn) == ("set", "set")
    assert player.made_hand_river == ""


def test_made_hands_stay_empty_without_cards_or_without_a_board() -> None:
    unknown = _player(1, "", "10", "0")
    preflop = _player(2, "Ac Ad", "10", "0")
    hand = _hand([unknown, preflop], "")
    fill_made_hands(hand)
    for player in (unknown, preflop):
        classes = (player.made_hand_flop, player.made_hand_turn, player.made_hand_river)
        assert classes == ("", "", "")


def test_enrich_is_idempotent() -> None:
    players = [_player(1, "Ac Ad", "100", "200"), _player(2, "Ks Kh", "100", "0")]
    hand = _hand(players, "2c 7d 9s Jh 3c")
    enrich(hand)
    first = [(p.allin_equity, p.ev_won, p.made_hand_river) for p in players]
    enrich(hand)
    assert [(p.allin_equity, p.ev_won, p.made_hand_river) for p in players] == first
