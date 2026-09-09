"""Tournament context for one hand. Part of the canonical model (`core.models`)."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from core.enums import TournamentKind, TournamentSpeed

ZERO = Decimal("0")


@dataclass(slots=True)
class Tournament:
    """Tournament context for one hand. `None` on cash-game hands.

    Modelled as a separate object rather than a dozen nullable columns on the hand so that
    "is this a tournament" is one check, and so adding a structure (mystery bounty, flip-out,
    progressive knockout variants) is one field here rather than a schema migration touching
    the main table.

    Covers heads-up SNGs through 10-max multi-day MTTs: nothing here assumes a table size, a
    payout shape, or a speed.
    """

    tournament_id: str
    kind: TournamentKind = TournamentKind.FREEZEOUT
    speed: TournamentSpeed = TournamentSpeed.NORMAL
    buy_in: Decimal = ZERO
    """Prize-pool contribution, excluding fee and bounty."""
    bounty: Decimal = ZERO
    """Per-elimination bounty at entry. Non-zero implies a knockout structure."""
    fee: Decimal = ZERO
    """The house's rake on entry."""
    currency: str = "USD"
    level: str = ""
    """As printed, e.g. "V" or "12"."""
    ante: Decimal = ZERO
    is_big_blind_ante: bool = False
    """One player posts the whole table's ante. Changes preflop pot odds materially."""
    players_remaining: int | None = None
    entrants: int | None = None
    prize_pool: Decimal | None = None
    finish_position: int | None = None
    """From the tournament summary file, not the hand history."""
    bounties_won: Decimal = ZERO
    is_satellite: bool = False
    table_size: int = 0
    """Seats at THIS table — differs from the tournament's nominal size on a broken table."""

    @property
    def total_entry_cost(self) -> Decimal:
        """What the seat actually cost: buy-in + bounty + fee."""
        return self.buy_in + self.bounty + self.fee

    @property
    def is_knockout(self) -> bool:
        """True for any bounty structure."""
        return self.bounty > 0 or self.kind in (
            TournamentKind.KNOCKOUT,
            TournamentKind.PROGRESSIVE_KO,
        )
