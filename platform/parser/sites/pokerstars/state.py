"""Mutable accumulator for one hand being parsed."""

from __future__ import annotations

from decimal import Decimal

from core.enums import ActionType, Street
from core.models import Action, CanonicalHand

ZERO = Decimal(0)


class HandState:
    """Everything the line handlers read and write while one hand is consumed.

    Kept as a plain class with explicit fields rather than a dict so a typo is an
    AttributeError instead of a silently missing value.
    """

    __slots__ = (
        "allin_seats",
        "contributed",
        "dealt_cards",
        "dealt_first",
        "folded_on",
        "hand",
        "in_summary",
        "kinds",
        "next_index",
        "pot",
        "seat_by_name",
        "seats_on",
        "showdown_seats",
        "street",
        "street_invested",
        "unparsed",
    )

    def __init__(self, hand: CanonicalHand) -> None:
        """Start empty around a freshly parsed header."""
        self.hand = hand
        self.street: Street | None = None
        self.in_summary = False
        self.next_index = 0
        self.pot = ZERO
        self.seat_by_name: dict[str, int] = {}
        self.dealt_cards: dict[str, tuple[str, ...]] = {}
        self.dealt_first: str | None = None
        self.contributed: dict[int, Decimal] = {}
        self.street_invested: dict[int, Decimal] = {}
        self.showdown_seats: set[int] = set()
        self.allin_seats: set[int] = set()
        self.folded_on: dict[int, Street] = {}
        self.seats_on: dict[Street, set[int]] = {s: set() for s in Street}
        self.unparsed: list[str] = []
        self.kinds: set[str] = set()

    def note_kind(self, kind: str) -> None:
        """Record that a line of this kind appeared, for the format signature."""
        self.kinds.add(kind)

    def seat_of(self, raw_name: str) -> int | None:
        """Resolve a printed screen name to a seat number, or None if unseated."""
        return self.seat_by_name.get(raw_name.strip())

    def reset_street(self) -> None:
        """Clear per-street bet tracking when a new street begins."""
        self.street_invested = {}

    def invested_this_street(self, seat: int) -> Decimal:
        """Chips this seat has put in on the current street."""
        return self.street_invested.get(seat, ZERO)

    def add_action(
        self,
        seat: int,
        action_type: ActionType,
        *,
        amount: Decimal = ZERO,
        amount_to: Decimal = ZERO,
        is_allin: bool = False,
    ) -> None:
        """Append an action and update the running pot and per-seat totals."""
        street = self.street or Street.PREFLOP
        to_call = max(ZERO, self._max_street_bet() - self.invested_this_street(seat))
        self.hand.actions.append(
            Action(
                action_index=self.next_index,
                street=street,
                seat=seat,
                action_type=action_type,
                amount=amount,
                amount_to=amount_to,
                pot_before=self.pot,
                to_call=to_call,
                is_allin=is_allin,
            )
        )
        self.next_index += 1
        if action_type is ActionType.FOLD:
            self.folded_on[seat] = street
        if is_allin:
            self.allin_seats.add(seat)
        self._apply_money(seat, action_type, amount)
        self._note_presence(seat, street)

    def _apply_money(self, seat: int, action_type: ActionType, amount: Decimal) -> None:
        """Move chips between the seat and the pot."""
        if action_type.puts_money_in:
            self.pot += amount
            self.contributed[seat] = self.contributed.get(seat, ZERO) + amount
            self.street_invested[seat] = self.invested_this_street(seat) + amount
        elif action_type is ActionType.UNCALLED_RETURN:
            self.pot -= amount
            self.contributed[seat] = self.contributed.get(seat, ZERO) - amount

    def _note_presence(self, seat: int, street: Street) -> None:
        """Record that a seat acted on a street.

        A player "saw" a street if they took any action on it. Postflop that is exactly
        right; preflop everyone dealt in is implied and handled separately.
        """
        if street in (Street.FLOP, Street.TURN, Street.RIVER):
            self.seats_on[street].add(seat)
        if street is Street.SHOWDOWN:
            self.showdown_seats.add(seat)

    def _max_street_bet(self) -> Decimal:
        return max(self.street_invested.values(), default=ZERO)
