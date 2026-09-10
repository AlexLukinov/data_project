"""Handlers for every line kind below the header. Each takes (line, state) and mutates state.

Anything unrecognized is RECORDED (`state.unparsed`), never dropped -- that is the early
warning for a site changing its format.
"""

from __future__ import annotations

from decimal import Decimal

from core.enums import ActionType, Street
from core.ids import player_key
from core.models import HandPlayer, PotWinner
from parser.base import parse_money
from parser.sites.pokerstars.grammar import (
    BOARD,
    CARDS_IN_BRACKETS,
    CASH_DROP,
    COLLECTED,
    DEALT,
    DROPS,
    RAKE,
    SEAT,
    SEAT_SUMMARY,
    STREET_BY_MARK,
    STREET_MARK,
    TABLE,
    TOTAL_POT,
    UNCALLED,
)
from parser.sites.pokerstars.state import HandState

ZERO = Decimal(0)


def table_line(line: str, state: HandState) -> None:
    """`Table 'Aludra II' 6-max Seat #3 is the button`."""
    match = TABLE.match(line)
    if not match:
        return
    state.hand.table_name = match.group("name")
    state.hand.max_seats = int(match.group("max") or 0)
    state.hand.button_seat = int(match.group("btn"))


def seat_line(line: str, state: HandState) -> None:
    """`Seat 1: Hero ($50.00 in chips)`."""
    match = SEAT.match(line)
    if not match:
        return
    name = match.group("name").strip()
    seat = int(match.group("seat"))
    state.hand.players.append(
        HandPlayer(
            seat=seat,
            screen_name=name,
            starting_stack=parse_money(match.group("stack")),
            player_key=player_key(state.hand.site, name),
        )
    )
    state.seat_by_name[name] = seat


def street_marker(line: str, state: HandState) -> None:
    """`*** FLOP *** [Ah 7c 2d]` and friends."""
    match = STREET_MARK.match(line)
    if not match:
        return
    name = match.group("name").strip()
    if name == "SUMMARY":
        state.in_summary = True
        return
    street = STREET_BY_MARK.get(name)
    if street is None:
        return
    state.street = street
    # Do NOT reset per-street bet tracking when preflop "starts": the blinds were posted
    # BEFORE the *** HOLE CARDS *** marker and are already part of preflop's investment.
    # Resetting here made `raises $0.75 to $1.25` from the small blind add 1.25 instead of
    # 1.00 -- silently inflating every 3-bet sizing stat. The pot-math validator caught it.
    if street in (Street.FLOP, Street.TURN, Street.RIVER):
        state.reset_street()
    # Board cards arrive on the marker line. FLOP prints one bracket group; TURN and
    # RIVER print the previous board plus the new card, so the LAST group is the new one.
    groups = CARDS_IN_BRACKETS.findall(match.group("rest"))
    if not groups:
        return
    if street is Street.FLOP:
        state.hand.board = tuple(groups[0].split())
    elif street in (Street.TURN, Street.RIVER):
        state.hand.board = (*state.hand.board, *groups[-1].split())


def dealt_line(line: str, state: HandState) -> None:
    """`Dealt to Hero [Ac Kd]` -- identifies the exporting player."""
    match = DEALT.match(line)
    if not match:
        return
    name = match.group("name").strip()
    cards = match.group("cards")
    if not cards:
        # GG prints a card-less `Dealt to <name>` line for EVERY seat. Treating the first
        # of those as the hero picks an arbitrary opponent — only a seat whose cards we
        # can actually see identifies the exporting player.
        return
    state.dealt_cards[name] = tuple(cards.split())
    if state.dealt_first is None:
        state.dealt_first = name


def summary_seat_line(line: str, state: HandState) -> bool:
    """`Seat 3: name (big blind) showed [Qd Js] and won ($6.08)` — cards, from the summary.

    On an observed table this is the ONLY place a villain's revealed cards appear, so skipping
    the summary block costs the pool its showdown ranges (docs/POKER_PLAN.md §6, F.8). On a
    self-exported hand the same cards already arrived from `Dealt to` or `: shows [..]`, and
    `setdefault` leaves those alone.

    The seat number identifies the player, not the printed name: the name is followed by an
    optional position parenthetical, and matching it loosely would attach cards to the wrong
    seat on a table with lookalike names.
    """
    match = SEAT_SUMMARY.match(line)
    if not match:
        return False
    seat = int(match.group("seat"))
    player = next((p for p in state.hand.players if p.seat == seat), None)
    if player is None:
        return True
    state.dealt_cards.setdefault(player.screen_name, tuple(match.group("cards").split()))
    # Both verbs mean the hand was shown down: cards are only printed here when they were.
    state.showdown_seats.add(seat)
    return True


def uncalled_line(line: str, state: HandState) -> None:
    """`Uncalled bet ($5.50) returned to Hero`."""
    match = UNCALLED.match(line)
    if not match:
        return
    seat = state.seat_of(match.group("name"))
    if seat is None:
        return
    state.add_action(seat, ActionType.UNCALLED_RETURN, amount=parse_money(match.group("amt")))


def collected_line(line: str, state: HandState) -> None:
    """`Hero collected $6.60 from pot` / `... from side pot-2`."""
    match = COLLECTED.match(line)
    if not match:
        return
    seat = state.seat_of(match.group("name"))
    if seat is None:
        return
    label = match.group("pot")
    index = 0 if label in ("pot", "main pot") else side_pot_index(label)
    state.hand.pot_winners.append(
        PotWinner(pot_index=index, seat=seat, amount_won=parse_money(match.group("amt")))
    )


def side_pot_index(label: str) -> int:
    """Map `side pot` / `side pot-2` to a pot index (main pot is 0)."""
    if "-" in label:
        return int(label.rsplit("-", 1)[1])
    return 1


def total_pot_line(line: str, state: HandState) -> None:
    """`Total pot $7.25 | Rake $0.65 | Jackpot ...`."""
    match = TOTAL_POT.match(line)
    if not match:
        return
    state.hand.total_pot = parse_money(match.group("pot"))
    rake_match = RAKE.search(line)
    state.hand.rake = parse_money(rake_match.group("rake") if rake_match else "")
    state.hand.jackpot_drop = sum((parse_money(v) for v in DROPS.findall(line)), ZERO)


def cash_drop_line(line: str, state: HandState) -> None:
    """Record house-added money. Additive: some formats print more than one drop line."""
    match = CASH_DROP.match(line)
    if not match:
        return
    state.hand.cash_drop += parse_money(match.group("amt"))


def board_line(line: str, state: HandState) -> None:
    """`Board [Ah 7c 2d Ks 9s]` in the summary."""
    match = BOARD.match(line)
    if match:
        state.hand.board = tuple(match.group("cards").split())
