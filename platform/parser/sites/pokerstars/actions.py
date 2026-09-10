"""Action lines: everything of the form `<name>: <verb> ...`.

Split out of `lines.py` when that file reached the 300-line limit; the seam is real, not
arbitrary — these are the lines that add an `Action` to the hand, and every other handler in
`lines.py` sets a field on the hand or a seat.
"""

from __future__ import annotations

from core.enums import ActionType
from parser.base import parse_money
from parser.sites.pokerstars.grammar import (
    ACT_CASHOUT,
    ACT_POST,
    ACT_RAISE,
    ACT_SHOW,
    ACT_SIMPLE,
    POST_TO_ACTION,
    VERB_TO_ACTION,
)
from parser.sites.pokerstars.state import HandState


def action_line(line: str, state: HandState) -> bool:
    """Apply an action line. Returns False when nothing matched."""
    if ":" not in line:
        return False
    return (
        _raise(line, state)
        or _post(line, state)
        or _simple(line, state)
        or (_cashout(line, state) or _show(line, state))
    )


def _raise(line: str, state: HandState) -> bool:
    match = ACT_RAISE.match(line)
    if not match:
        return False
    state.note_kind("raise")
    seat = state.seat_of(match.group("name"))
    if seat is None:
        return True
    to_total = parse_money(match.group("to"))
    # `raises X to Y`: Y is the player's total for the street, so the chips actually
    # added now are Y minus whatever they already had in on this street. Getting this
    # wrong is the classic parser bug, and pot-math validation catches it.
    state.add_action(
        seat,
        ActionType.RAISE,
        amount=to_total - state.invested_this_street(seat),
        amount_to=to_total,
        is_allin=bool(match.group("allin")),
    )
    return True


def _post(line: str, state: HandState) -> bool:
    match = ACT_POST.match(line)
    if not match:
        return False
    state.note_kind("post")
    seat = state.seat_of(match.group("name"))
    if seat is None:
        return True
    action_type = POST_TO_ACTION.get(match.group("what"), ActionType.POST_DEAD)
    amount = parse_money(match.group("amt") or "")
    state.add_action(seat, action_type, amount=amount, amount_to=amount)
    if action_type is ActionType.POST_ANTE:
        state.hand.ante = max(state.hand.ante, amount)
    elif action_type is ActionType.POST_STRADDLE:
        state.hand.straddle = max(state.hand.straddle, amount)
    return True


def _simple(line: str, state: HandState) -> bool:
    match = ACT_SIMPLE.match(line)
    if not match:
        return False
    state.note_kind("action")
    seat = state.seat_of(match.group("name"))
    if seat is None:
        return True
    amount = parse_money(match.group("amt") or "")
    state.add_action(
        seat,
        VERB_TO_ACTION[match.group("verb")],
        amount=amount,
        amount_to=state.invested_this_street(seat) + amount,
        is_allin=bool(match.group("allin")),
    )
    return True


def _cashout(line: str, state: HandState) -> bool:
    match = ACT_CASHOUT.match(line)
    if not match:
        return False
    state.note_kind("cashout")
    seat = state.seat_of(match.group("name"))
    if seat is not None and match.group("amt"):
        # Recorded on the player, not as a pot contribution: the cashout fee leaves the
        # player's stack without entering the pot, so adding it to `contributed` would
        # break the pot-math reconciliation it is not part of.
        player = state.hand.player_at(seat)
        if player is not None:
            player.extra["cashout_risk"] = match.group("amt")
    return True


def _show(line: str, state: HandState) -> bool:
    match = ACT_SHOW.match(line)
    if not match:
        return False
    state.note_kind("show")
    seat = state.seat_of(match.group("name"))
    if seat is None:
        return True
    cards = match.group("cards")
    if cards:
        state.dealt_cards.setdefault(match.group("name").strip(), tuple(cards.split()))
    is_show = match.group("verb") == "shows"
    state.add_action(seat, ActionType.SHOW if is_show else ActionType.MUCK)
    # Declining to show after everyone folded is NOT a showdown. Counting it as one
    # would inflate WTSD on every hand won without a call.
    if is_show or match.group("verb") == "mucks":
        state.showdown_seats.add(seat)
    return True
