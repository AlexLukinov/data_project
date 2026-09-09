"""The canonical hand model — the contract every parser emits and every consumer reads.

**Why dataclasses and not Pydantic here.** This is the hot path: a bulk import runs this
constructor millions of times, and Pydantic validates on every instantiation. Measured
guidance from docs/POKER_DATA_MODEL.md §10 — per-hand Pydantic validation is one of the three
things that actually hurts Python parse throughput. So:

  * hot path (parser -> model -> ClickHouse)  -> dataclasses with `slots=True`
  * API boundary (untrusted JSON in/out)      -> Pydantic v2, in `api/schemas.py`

`slots=True` also cuts per-instance memory ~30-40%, which matters when 10k hands are in
flight in a worker batch.

Money is `Decimal` everywhere, never `float`. Money that doesn't sum exactly is a support
ticket, and `0.1 + 0.2` is the reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from core.enums import (
    ActionType,
    GameType,
    LimitType,
    Position,
    Site,
    Street,
    TableFormat,
    TournamentKind,
    TournamentSpeed,
)

ZERO = Decimal("0")

SCHEMA_VERSION = 1
"""Version of the canonical model itself.

Bump on any change to what a field MEANS. Adding an optional field does not require a bump;
redefining `net_won` to be pre-rake would. Stored on every row so a mixed-version table stays
interpretable — which it will be, because re-parsing everything is a background job that
takes hours, not an atomic switch."""


@dataclass(slots=True)
class Action:
    """One decision or chip movement, in global order within the hand.

    `action_index` is global across streets, not per-street: stat logic constantly asks
    "did anyone raise *before* this player acted", and that question is unanswerable from a
    per-street counter.
    """

    action_index: int
    street: Street
    seat: int
    action_type: ActionType
    amount: Decimal = ZERO
    """Chips this action added to the pot."""
    amount_to: Decimal = ZERO
    """For raises: the total being raised *to*. Sites print both ("raises $1.50 to $2.00")
    and confusing them is the classic parser bug."""
    pot_before: Decimal = ZERO
    to_call: Decimal = ZERO
    is_allin: bool = False
    cards_revealed: str = ""
    """Cards shown by this action (`show` / a showdown line), space-delimited; empty when the
    action revealed nothing. Stored on `core.actions` since migration 0003; parsers fill it
    when the format prints cards on the action line."""

    @property
    def is_voluntary(self) -> bool:
        """True when the player chose to put money in — blinds and antes did not choose.

        This one property is why VPIP is correct.
        """
        return self.action_type.puts_money_in and not self.action_type.is_post


@dataclass(slots=True)
class HandPlayer:
    """One occupied seat in one hand."""

    seat: int
    screen_name: str
    starting_stack: Decimal
    player_key: str | None = None
    """`site:lower(screen_name)`. None when the site anonymizes opponents."""
    is_hero: bool = False
    is_anonymized: bool = False
    anon_alias: str = ""
    """The site's pseudonym for an anonymized opponent. On GGPoker it is a hex alias that
    recurs across roughly 2.8 tables within an export (see parser/sites/ggpoker.py), so it is
    stable *within a session*, never across sessions or exports. Do not build opponent
    tracking on it; `player_key` is NULL for exactly that reason."""
    position: Position = Position.UNKNOWN
    position_index: int = 0
    """0 = first to act preflop."""
    hole_cards: tuple[str, ...] = ()
    """Empty means UNKNOWN, which is different from "no cards". Length varies by variant:
    2 for Hold'em, 4 for PLO."""
    total_invested: Decimal = ZERO
    net_won: Decimal = ZERO
    """Signed, after rake."""
    allin_equity: Decimal | None = None
    ev_won: Decimal | None = None
    """All-in-adjusted result. None when no all-in occurred. See ADR-018."""
    saw_flop: bool = False
    saw_turn: bool = False
    saw_river: bool = False
    went_to_showdown: bool = False
    won_hand: bool = False
    bounty_won: Decimal = ZERO
    was_eliminated: bool = False
    extra: dict[str, str] = field(default_factory=dict)
    """Unmodelled per-seat values preserved verbatim — see `CanonicalHand.extra`."""


@dataclass(slots=True)
class PotWinner:
    """One seat's share of one pot. Split pots and side pots both need this."""

    pot_index: int
    seat: int
    amount_won: Decimal


@dataclass(slots=True)
class Pot:
    """A main or side pot. Three all-in stacks of different sizes make this non-optional."""

    pot_index: int
    amount: Decimal
    rake_share: Decimal = ZERO
    is_side: bool = False


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


@dataclass(slots=True)
class CanonicalHand:
    """One hand, normalized. The output of `parse()` and the input to everything else.

    Site-specific knowledge stops here: nothing downstream branches on `site` except for
    display and the `is_anonymized` flag.
    """

    # -- identity ---------------------------------------------------------------
    site: Site
    site_hand_id: str
    played_at_utc: datetime
    # -- game ------------------------------------------------------------------
    game_type: GameType
    limit_type: LimitType
    table_format: TableFormat
    currency: str
    small_blind: Decimal
    big_blind: Decimal
    max_seats: int
    button_seat: int
    # -- content ---------------------------------------------------------------
    players: list[HandPlayer] = field(default_factory=list)
    actions: list[Action] = field(default_factory=list)
    pots: list[Pot] = field(default_factory=list)
    pot_winners: list[PotWinner] = field(default_factory=list)
    board: tuple[str, ...] = ()
    """Up to 5 cards, in dealt order: flop[0:3], turn[3], river[4]."""
    # -- money -----------------------------------------------------------------
    ante: Decimal = ZERO
    straddle: Decimal = ZERO
    total_pot: Decimal = ZERO
    rake: Decimal = ZERO
    jackpot_drop: Decimal = ZERO
    """Deductions taken from the pot ALONGSIDE rake — GG prints Jackpot / Bingo / Fortune /
    Tax, PokerStars has its own promotional drops. Not rake, and not won by anyone, so the
    pot only reconciles when they are accounted for separately."""
    cash_drop: Decimal = ZERO
    """Money the HOUSE adds to the pot, in the opposite direction to every other amount here.

    GG's Cash Drop promotion prints `Cash Drop to Pot : total $2.50` and the winner collects
    that much more than the players put in. It is genuinely won money — it belongs in net_won
    and therefore in win-rate — but it never came out of anybody's stack, so it is the one
    term that sits on the CONTRIBUTED side of the reconciliation rather than the awarded side.

    Kept separate from `jackpot_drop` deliberately: they have opposite signs, and adding a
    negative jackpot would make `rake + jackpot_drop` stop meaning "what the house took"."""
    # -- context ---------------------------------------------------------------
    table_name: str = ""
    hero_seat: int | None = None
    tournament: Tournament | None = None
    """Tournament context, or None for cash games. See `Tournament`."""
    played_at_local: datetime | None = None
    tz_source: str = ""
    """What the file actually said. Keeping it makes a timezone bug diagnosable rather than
    silently baked into every timestamp."""
    # -- forward compatibility -------------------------------------------------
    unparsed_lines: tuple[str, ...] = ()
    """Lines the parser did not recognize. **Never silently dropped.**

    This is the early-warning system for format drift: when a site adds a line type, these
    counts spike before any stat goes wrong, and the raw text needed to add support is
    already stored. A parser that quietly ignores what it does not understand fails silently,
    which is the one failure mode this product cannot afford."""
    extra: dict[str, str] = field(default_factory=dict)
    """Recognized-but-unmodelled key/values. Round-tripped to storage so a field can be
    promoted to a real column later WITHOUT re-parsing petabytes of text."""
    format_signature: str = ""
    """Fingerprint of this hand's structural shape (which line kinds appeared, in what
    order-classes). Grouping by it turns "did PokerStars change their format?" into a query."""

    # -- provenance ------------------------------------------------------------
    raw_text: str = ""
    raw_object_key: str = ""
    raw_byte_offset: int = 0
    parser_version: int = 1
    schema_version: int = SCHEMA_VERSION
    """Canonical-model version this row was produced against. Lets a consumer branch on shape
    instead of guessing, and makes a partial re-parse targetable (`WHERE schema_version < n`)."""

    # -- derived ---------------------------------------------------------------
    @property
    def hand_uid(self) -> str:
        """Deterministic dedup key: `sha256(site:site_hand_id)`, 128 bits of it.

        Deterministic is the whole point — the same hand parsed twice, by two parser versions,
        on two machines, must produce the same value or `ReplacingMergeTree` cannot collapse
        the duplicate and an at-least-once consumer stops being safe.
        """
        from core.ids import content_uid, hand_uid

        if self.site_hand_id:
            return hand_uid(self.site, self.site_hand_id)
        return content_uid(self.site, self.raw_text)

    @property
    def hole_card_count(self) -> int:
        """Cards dealt to each player, by variant. 0 where it varies by street (stud)."""
        return self.game_type.hole_cards

    @property
    def is_tournament(self) -> bool:
        """True when this hand was played in any tournament format."""
        return self.tournament is not None

    @property
    def tournament_id(self) -> str | None:
        """Convenience accessor kept for storage and for cash-game code paths."""
        return self.tournament.tournament_id if self.tournament else None

    @property
    def stake_level(self) -> str:
        """Human stake label.

        Cash: `NL50` — big blind in cents, prefixed by limit type.
        Tournament: total entry cost, because blind level is meaningless as a grouping key
        (the same $22 MTT passes through twenty blind levels, and they are one population).
        """
        if self.tournament is not None:
            total = self.tournament.total_entry_cost
            suffix = "KO" if self.tournament.is_knockout else ""
            return f"T{total.normalize():f}{suffix}"
        cents = int(self.big_blind * 100)
        return f"{self.limit_type.value.upper()}{cents}"

    @property
    def players_dealt_in(self) -> int:
        """Seats actually dealt cards. Position derivation uses this, never `max_seats`."""
        return len(self.players)

    @property
    def flop(self) -> tuple[str, ...]:
        """The three flop cards, or empty if the hand ended preflop."""
        return self.board[:3]

    def player_at(self, seat: int) -> HandPlayer | None:
        """Return the player in `seat`, or None if the seat was empty."""
        for p in self.players:
            if p.seat == seat:
                return p
        return None

    @property
    def hero(self) -> HandPlayer | None:
        """The uploading user's seat, if they were dealt in."""
        for p in self.players:
            if p.is_hero:
                return p
        return None

    def actions_on(self, street: Street) -> list[Action]:
        """All actions on one street, in order."""
        return [a for a in self.actions if a.street == street]
