"""Everything that can only be known once the whole hand has been read."""

from __future__ import annotations

import hashlib
from decimal import Decimal

from core.enums import Street
from core.models import HandPlayer, Pot
from core.positions import assign_positions, preflop_order
from parser.errors import HandParseError
from parser.sites.pokerstars.state import HandState

ZERO = Decimal(0)
SIGNATURE_CHARS = 12


def finalize(state: HandState, hero_names: frozenset[str] | None) -> None:
    """Derive positions, results, street flags, showdown, hero and the format signature."""
    hand = state.hand
    if not hand.players:
        raise HandParseError("no seats parsed", hand.raw_text)

    seats = [p.seat for p in hand.players]
    positions = assign_positions(hand.button_seat, seats)
    order = preflop_order(hand.button_seat, seats)
    awarded = _awarded(state)
    hero_seat = resolve_hero(state, hero_names)
    reached = _reached(state)
    live_at_river = [
        p.seat
        for p in hand.players
        if reached[Street.RIVER] and _live_through(state, p.seat, Street.RIVER)
    ]

    for player in hand.players:
        player.position = positions.get(player.seat, player.position)
        player.position_index = order.get(player.seat, 0)
        _settle(state, player, awarded, reached, live_at_river)
        player.is_hero = player.seat == hero_seat

    hand.unparsed_lines = tuple(state.unparsed)
    # Fingerprint of the structural shape. Grouping stored hands by this turns "did the
    # site change their format?" into a query rather than a support ticket.
    hand.format_signature = hashlib.sha256(("|".join(sorted(state.kinds))).encode()).hexdigest()[
        :SIGNATURE_CHARS
    ]
    hand.hero_seat = hero_seat
    if not hand.max_seats:
        hand.max_seats = len(hand.players)
    if not hand.pots and hand.total_pot:
        hand.pots = [Pot(pot_index=0, amount=hand.total_pot, rake_share=hand.rake)]


def _awarded(state: HandState) -> dict[int, Decimal]:
    awarded: dict[int, Decimal] = {}
    for winner in state.hand.pot_winners:
        awarded[winner.seat] = awarded.get(winner.seat, ZERO) + winner.amount_won
    return awarded


def _reached(state: HandState) -> dict[Street, bool]:
    """Which streets were dealt.

    "Saw the flop" means STILL LIVE when the flop was dealt -- not "acted on the flop": in
    an all-in pot both players see all five cards and neither acts again, and defining it
    by action would undercount WWSF and WTSD on exactly the hands where the most money moved.
    """
    n = len(state.hand.board)
    return {Street.FLOP: n >= 3, Street.TURN: n >= 4, Street.RIVER: n >= 5}


def _live_through(state: HandState, seat: int, street: Street) -> bool:
    """A player is live through a street if they never folded, or folded on a LATER street."""
    folded_on = state.folded_on.get(seat)
    return folded_on is None or folded_on.order > street.order


def _settle(
    state: HandState,
    player: HandPlayer,
    awarded: dict[int, Decimal],
    reached: dict[Street, bool],
    live_at_river: list[int],
) -> None:
    """Cards, money and street flags for one seat."""
    seat = player.seat
    player.hole_cards = state.dealt_cards.get(player.screen_name, ())
    player.total_invested = state.contributed.get(seat, ZERO)
    player.net_won = awarded.get(seat, ZERO) - player.total_invested
    player.saw_flop = reached[Street.FLOP] and _live_through(state, seat, Street.PREFLOP)
    player.saw_turn = reached[Street.TURN] and _live_through(state, seat, Street.FLOP)
    player.saw_river = reached[Street.RIVER] and _live_through(state, seat, Street.TURN)
    # Showdown: an explicit show/muck, or still live at the river with company. The second
    # clause catches all-in run-outs, where nobody acts and some sites print no show line
    # for the loser.
    player.went_to_showdown = seat in state.showdown_seats or (
        seat in live_at_river and len(live_at_river) >= 2
    )
    player.won_hand = awarded.get(seat, ZERO) > 0


def resolve_hero(state: HandState, hero_names: frozenset[str] | None) -> int | None:
    """Decide which seat is the uploading user.

    Registered screen names win when supplied — they are authoritative. Otherwise fall
    back to the first `Dealt to` line, which in a self-exported history is the exporter.
    """
    if hero_names:
        for name, seat in state.seat_by_name.items():
            if name.lower() in hero_names:
                return seat
    if state.dealt_first is not None:
        return state.seat_by_name.get(state.dealt_first)
    return None
