"""Hand validation — reconcile the money, then reject what doesn't balance.

**Why this exists and why it is strict.** The worst failure mode in an analytics product is
not a crash; it is a plausible wrong number. A parser that silently mis-reads a raise-to
amount produces a hand that looks fine, imports fine, and quietly corrupts every aggression
stat that touches it. Pot-math reconciliation is the check that catches that class of bug,
because a mis-parsed amount almost always fails to balance.

The rule, in one line:

    sum(all chips put in) - sum(uncalled bets returned) == sum(awarded to winners) + rake

Everything else here is a cheaper sanity check on top of that.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from core.enums import ActionType, Street
from core.models import CanonicalHand

CENT = Decimal("0.01")
"""Tolerance for the pot reconciliation. Sites round rake to the cent and some print
per-player rake shares that don't re-sum exactly; a whole cent of slack absorbs that without
hiding a real mis-parse (which is off by a bet, not by a cent)."""


class Severity(StrEnum):
    """How bad a finding is. `ERROR` means the hand must not be stored."""

    ERROR = "error"
    WARNING = "warning"


@dataclass(slots=True, frozen=True)
class Finding:
    """One validation problem."""

    code: str
    severity: Severity
    message: str


@dataclass(slots=True)
class ValidationResult:
    """Outcome of validating one hand."""

    findings: list[Finding]

    @property
    def ok(self) -> bool:
        """True when the hand is safe to store."""
        return not any(f.severity is Severity.ERROR for f in self.findings)

    @property
    def errors(self) -> list[Finding]:
        """Only the blocking findings."""
        return [f for f in self.findings if f.severity is Severity.ERROR]

    def summary(self) -> str:
        """One-line description for logs and the dead-letter record."""
        return "; ".join(f"{f.code}: {f.message}" for f in self.findings) or "ok"


def contributed_by_seat(hand: CanonicalHand) -> dict[int, Decimal]:
    """Total chips each seat put into the pot, net of uncalled returns."""
    totals: dict[int, Decimal] = {p.seat: Decimal(0) for p in hand.players}
    for action in hand.actions:
        if action.seat not in totals:
            continue
        if action.action_type.puts_money_in:
            totals[action.seat] += action.amount
        elif action.action_type is ActionType.UNCALLED_RETURN:
            totals[action.seat] -= action.amount
    return totals


def awarded_by_seat(hand: CanonicalHand) -> dict[int, Decimal]:
    """Total chips each seat won across all pots."""
    totals: dict[int, Decimal] = {p.seat: Decimal(0) for p in hand.players}
    for winner in hand.pot_winners:
        if winner.seat in totals:
            totals[winner.seat] += winner.amount_won
    return totals


def validate(hand: CanonicalHand) -> ValidationResult:
    """Run every check against one parsed hand."""
    findings: list[Finding] = []
    findings += _check_structure(hand)
    findings += _check_cards(hand)
    findings += _check_pot_math(hand)
    findings += _check_net_won(hand)
    return ValidationResult(findings)


def _err(code: str, message: str) -> Finding:
    return Finding(code, Severity.ERROR, message)


def _warn(code: str, message: str) -> Finding:
    return Finding(code, Severity.WARNING, message)


def _check_structure(hand: CanonicalHand) -> list[Finding]:
    """Basic shape: enough players, a button, sane blinds, ordered actions."""
    out: list[Finding] = []
    if len(hand.players) < 2:
        out.append(_err("too_few_players", f"{len(hand.players)} player(s) dealt in"))
    if hand.big_blind <= 0:
        out.append(_err("bad_blinds", f"big_blind={hand.big_blind}"))
    if hand.small_blind > hand.big_blind:
        out.append(_warn("odd_blinds", f"sb {hand.small_blind} > bb {hand.big_blind}"))

    seats = [p.seat for p in hand.players]
    if len(seats) != len(set(seats)):
        out.append(_err("duplicate_seat", "two players share a seat number"))

    indices = [a.action_index for a in hand.actions]
    if indices != sorted(indices):
        out.append(_err("actions_unordered", "action_index is not monotonically increasing"))

    known = set(seats)
    for action in hand.actions:
        if action.seat not in known:
            out.append(
                _err(
                    "action_unknown_seat", f"action {action.action_index} on unseated {action.seat}"
                )
            )
            break

    # A street can only appear if the previous one did. Catches a truncated hand where the
    # summary block was cut off mid-file.
    seen = {a.street for a in hand.actions}
    for earlier, later in ((Street.FLOP, Street.TURN), (Street.TURN, Street.RIVER)):
        if later in seen and earlier not in seen:
            out.append(_err("street_gap", f"{later} present without {earlier}"))
    return out


def _check_cards(hand: CanonicalHand) -> list[Finding]:
    """No card may appear twice across the board and all revealed hole cards."""
    out: list[Finding] = []
    expected = hand.hole_card_count
    seen: dict[str, str] = {}

    for card in hand.board:
        if card in seen:
            out.append(_err("duplicate_card", f"{card} appears twice (board)"))
        seen[card] = "board"

    if len(hand.board) not in (0, 3, 4, 5):
        out.append(_err("bad_board", f"{len(hand.board)} board cards"))

    for player in hand.players:
        if not player.hole_cards:
            continue  # unknown is legitimate: opponents who never showed
        if len(player.hole_cards) != expected:
            out.append(
                _warn(
                    "bad_hole_count",
                    f"seat {player.seat} has {len(player.hole_cards)} cards, expected {expected}",
                )
            )
        for card in player.hole_cards:
            if card in seen:
                out.append(
                    _err(
                        "duplicate_card",
                        f"{card} appears twice ({seen[card]} and seat {player.seat})",
                    )
                )
            seen[card] = f"seat {player.seat}"
    return out


def _check_pot_math(hand: CanonicalHand) -> list[Finding]:
    """The load-bearing check: contributed - returned == awarded + rake."""
    contributed = sum(contributed_by_seat(hand).values(), Decimal(0))
    awarded = sum(awarded_by_seat(hand).values(), Decimal(0))

    if not hand.pot_winners:
        # No settlement parsed — can't reconcile. Compare against the printed total instead.
        if hand.total_pot and abs(contributed - hand.total_pot) > CENT:
            return [
                _err(
                    "pot_mismatch",
                    f"contributions {contributed} != printed pot {hand.total_pot}",
                )
            ]
        return [_warn("no_winners", "hand has no pot_winners; settlement not reconciled")]

    # contributed - returned == awarded + rake + promotional drops.
    expected = awarded + hand.rake + hand.jackpot_drop
    if abs(contributed - expected) > CENT:
        return [
            _err(
                "pot_mismatch",
                f"contributed {contributed} != awarded {awarded} + rake {hand.rake} "
                f"(off by {contributed - expected})",
            )
        ]
    return []


def _check_net_won(hand: CanonicalHand) -> list[Finding]:
    """Each player's `net_won` must equal what they won minus what they put in."""
    out: list[Finding] = []
    contributed = contributed_by_seat(hand)
    awarded = awarded_by_seat(hand)
    if not hand.pot_winners:
        return out
    for player in hand.players:
        expected = awarded[player.seat] - contributed[player.seat]
        if abs(player.net_won - expected) > CENT:
            out.append(
                _warn(
                    "net_won_mismatch",
                    f"seat {player.seat}: net_won {player.net_won} != {expected}",
                )
            )
    return out
