"""The stored-column path must reach the same answer as the parse-time path.

There are two callers of the money model: `core.allin.fill_all_in_ev`, which reads a freshly
parsed `CanonicalHand`, and `scripts.backfill_equity`, which rebuilds the same spot out of
`core.hands` and `core.hand_players`. They share `all_in_result`, so the arithmetic cannot
differ — but the *judgements* around it (where betting stopped, who was contesting, whether the
runout happened) are made twice from different shapes, and those are what a test has to pin.

Nothing here touches ClickHouse: the storage path's `Hand` is a plain dataclass, so the rows it
would have been built from are written out by hand.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from core.allin import enrich
from core.enums import Street
from scripts.backfill_equity import fill_ev, fill_made_hands
from scripts.equity_store import Hand, Seat
from tests.test_allin import _hand, _player


def _mirror(players: list, board: str, last_street: Street, big_blind: str = "1") -> Hand:
    """The same hand as `tests.test_allin` builds, in the shape the backfill reads."""
    return Hand(
        uid="h1",
        big_blind=Decimal(big_blind),
        board=tuple(board.split()) if board else (),
        last_street=last_street,
        has_allin=True,
        seats=[
            Seat(
                seat=p.seat,
                hole=p.hole_cards,
                invested=p.total_invested,
                net_won=p.net_won,
                showdown=p.went_to_showdown,
            )
            for p in players
        ],
    )


def _both(players: list, board: str, street: Street = Street.PREFLOP):
    """Run both paths over the same hand and return (parse-time seats, storage seats)."""
    parsed = _hand(players, board)
    for action in parsed.actions:
        action.street = street
    enrich(parsed)
    stored = _mirror(players, board, street)
    fill_made_hands(stored)
    fill_ev(stored)
    return parsed.players, stored.seats


def test_the_two_paths_agree_on_a_heads_up_preflop_all_in() -> None:
    players = [_player(1, "Ac Ad", "100", "200"), _player(2, "Ks Kh", "100", "0")]
    parsed, stored = _both(players, "2c 7d 9s Jh 3c")
    for seat, row in zip(parsed, stored, strict=True):
        assert seat.allin_equity == row.equity
        assert seat.ev_won == row.ev_won_bb  # big blind is 1, so bb and chips coincide


def test_the_two_paths_agree_with_dead_money_and_a_side_pot() -> None:
    players = [
        _player(1, "Ac Ad", "40", "130"),
        _player(2, "Ks Kh", "100", "0"),
        _player(3, "Qc Qd", "100", "70"),
    ]
    parsed, stored = _both(players, "2c 7d 9s Jh 3c")
    assert [p.allin_equity for p in parsed] == [s.equity for s in stored]
    assert [p.ev_won for p in parsed] == [s.ev_won_bb for s in stored]
    assert all(s.equity is not None for s in stored)


def test_the_two_paths_agree_that_a_cash_out_gets_no_adjustment() -> None:
    """The board stops where betting stopped, so neither path may invent a swing."""
    players = [_player(1, "Ac Ad", "100", "100"), _player(2, "Ks Kh", "100", "100")]
    parsed, stored = _both(players, "")
    assert all(p.ev_won is None for p in parsed)
    assert all(s.ev_won_bb is None for s in stored)


def test_the_two_paths_agree_on_made_hands_per_street() -> None:
    players = [_player(1, "Ac Ad", "10", "0"), _player(2, "7h 6h", "10", "0")]
    parsed, stored = _both(players, "Ah 7d 2c 3s 9h")
    for seat, row in zip(parsed, stored, strict=True):
        assert [seat.made_hand_flop, seat.made_hand_turn, seat.made_hand_river] == row.made


def test_ev_is_expressed_in_big_blinds_by_the_storage_path() -> None:
    """The parse-time path stores chips and the loader divides; this path divides itself."""
    players = [_player(1, "Ac Ad", "100", "200"), _player(2, "Ks Kh", "100", "0")]
    stored = _mirror(players, "2c 7d 9s Jh 3c", Street.PREFLOP, big_blind="2")
    fill_ev(stored)
    assert stored.seats[0].ev_won_bb == pytest.approx(Decimal("31.2555"), abs=Decimal("0.0002"))
