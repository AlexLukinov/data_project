"""Closed vocabularies shared by every layer.

Why `StrEnum` and not plain strings: these values become ClickHouse `Enum8` columns and dbt
`accepted_values` tests. A typo in a string literal is a silent wrong-stat bug; a typo in an
enum member is an ImportError at startup. Fail loudly, early.
"""

from enum import StrEnum


class Site(StrEnum):
    """Poker network a hand came from. Screen names are unique *per site*, never across sites."""

    POKERSTARS = "pokerstars"
    GGPOKER = "ggpoker"
    WPN = "wpn"
    IPOKER = "ipoker"
    PARTYPOKER = "partypoker"
    WINAMAX = "winamax"
    EIGHT88 = "888"


class GameStructure(StrEnum):
    """How cards are dealt. The axis that actually matters to the parser and the model.

    Branching on this instead of on the specific variant is what keeps stud and draw games
    from becoming a rewrite: a new flop game is a new `GameType` member and nothing else,
    while a new *structure* is the only thing that needs real work.
    """

    FLOP = "flop"
    """Hold'em, Omaha and friends: private cards + shared community board."""
    STUD = "stud"
    """Seven-card stud family: mixed up/down cards, no community board, bring-in instead of
    blinds, five betting rounds (third through seventh street)."""
    DRAW = "draw"
    """Five-card draw, badugi, triple draw: private cards exchanged over draw rounds."""
    MIXED = "mixed"
    """Rotating games (HORSE, 8-Game): the variant changes between hands."""


class GameType(StrEnum):
    """Card-game variant. Drives hole-card count, structure and hand evaluation.

    Deliberately broad from day one. Adding a variant later is cheap *if* the model never
    assumed two hole cards and a community board; it is a migration of every table if it did.
    """

    # -- flop games -----------------------------------------------------------
    HOLDEM = "holdem"
    SHORTDECK = "shortdeck"
    OMAHA = "omaha"
    OMAHA_HI_LO = "omaha_hi_lo"
    OMAHA5 = "omaha5"
    OMAHA6 = "omaha6"
    COURCHEVEL = "courchevel"
    # -- stud games -----------------------------------------------------------
    STUD = "stud"
    STUD_HI_LO = "stud_hi_lo"
    RAZZ = "razz"
    # -- draw games -----------------------------------------------------------
    DRAW5 = "draw5"
    BADUGI = "badugi"
    TRIPLE_DRAW_27 = "triple_draw_27"
    SINGLE_DRAW_27 = "single_draw_27"
    # -- special formats ------------------------------------------------------
    ALLIN_OR_FOLD = "allin_or_fold"
    """Push/fold only — no postflop betting. Common in hyper-turbo Spin & Go finals."""
    FLIPOUT = "flipout"
    """All-in every hand until one player remains."""
    # -- rotating -------------------------------------------------------------
    HORSE = "horse"
    EIGHT_GAME = "eight_game"
    MIXED = "mixed"
    # -- escape hatch ---------------------------------------------------------
    UNKNOWN = "unknown"
    """A variant this build does not model yet.

    **This member is the extensibility mechanism, not a bug.** When a site launches a game we
    have never seen, hands still import — tagged UNKNOWN, with the printed name preserved in
    `CanonicalHand.extra['game_raw']` — instead of the whole file failing. You then see it in
    one query, add the enum member and the name mapping, and re-parse from stored raw text.
    Two lines of code and a background job, rather than a data-loss incident."""

    @property
    def structure(self) -> GameStructure:
        """Which dealing structure this variant uses."""
        return _STRUCTURE.get(self, GameStructure.FLOP)

    @property
    def hole_cards(self) -> int:
        """Private cards dealt to each player. 0 where it varies by street (stud)."""
        return _HOLE_CARD_COUNT.get(self, 2)

    @property
    def has_community_board(self) -> bool:
        """True when the hand has a shared board — false for stud and draw games."""
        return self.structure is GameStructure.FLOP

    @property
    def is_hi_lo(self) -> bool:
        """True for split-pot games, where a single winner column is wrong."""
        return self in (GameType.OMAHA_HI_LO, GameType.STUD_HI_LO)


_STRUCTURE: dict[GameType, GameStructure] = {
    GameType.ALLIN_OR_FOLD: GameStructure.FLOP,
    GameType.FLIPOUT: GameStructure.FLOP,
    GameType.STUD: GameStructure.STUD,
    GameType.STUD_HI_LO: GameStructure.STUD,
    GameType.RAZZ: GameStructure.STUD,
    GameType.DRAW5: GameStructure.DRAW,
    GameType.BADUGI: GameStructure.DRAW,
    GameType.TRIPLE_DRAW_27: GameStructure.DRAW,
    GameType.SINGLE_DRAW_27: GameStructure.DRAW,
    GameType.HORSE: GameStructure.MIXED,
    GameType.EIGHT_GAME: GameStructure.MIXED,
    GameType.MIXED: GameStructure.MIXED,
}

_HOLE_CARD_COUNT: dict[GameType, int] = {
    GameType.HOLDEM: 2,
    GameType.SHORTDECK: 2,
    GameType.OMAHA: 4,
    GameType.OMAHA_HI_LO: 4,
    GameType.OMAHA5: 5,
    GameType.OMAHA6: 6,
    GameType.COURCHEVEL: 5,
    GameType.DRAW5: 5,
    GameType.BADUGI: 4,
    GameType.TRIPLE_DRAW_27: 5,
    GameType.SINGLE_DRAW_27: 5,
    # Stud deals a varying number across streets, so a fixed count is meaningless.
    GameType.STUD: 0,
    GameType.STUD_HI_LO: 0,
    GameType.RAZZ: 0,
    GameType.ALLIN_OR_FOLD: 2,
    GameType.FLIPOUT: 2,
    GameType.UNKNOWN: 2,
}


class LimitType(StrEnum):
    """Betting structure."""

    NL = "nl"
    PL = "pl"
    FL = "fl"


class TableFormat(StrEnum):
    """Money format. `rush` = fast-fold pools (GG Rush & Cash, Stars Zoom).

    Fast-fold matters structurally: the table dissolves after every hand, so `table_name`
    carries no continuity and nothing may assume table persistence.
    """

    CASH = "cash"
    MTT = "mtt"
    SNG = "sng"
    SPIN = "spin"
    RUSH = "rush"


class TournamentKind(StrEnum):
    """Tournament payout/re-entry structure.

    Kept separate from `TableFormat` because they are orthogonal: a hyper-turbo Spin & Go is
    a `spin` format with `progressive_ko` payouts, and a bounty MTT is `mtt` + `knockout`.
    Collapsing them into one field is the modelling mistake that makes bounty analysis
    impossible later.
    """

    NONE = "none"
    """Cash game — no tournament structure."""
    FREEZEOUT = "freezeout"
    REBUY = "rebuy"
    KNOCKOUT = "knockout"
    """Fixed bounty per elimination."""
    PROGRESSIVE_KO = "progressive_ko"
    """PKO/Mystery: part of the bounty transfers to the winner's own head."""
    SATELLITE = "satellite"
    """Seat-award payouts — ICM behaves completely differently near the bubble."""
    SHOOTOUT = "shootout"


class TournamentSpeed(StrEnum):
    """Blind-level speed. Drives effective stack depth, which drives strategy entirely."""

    NONE = "none"
    SLOW = "slow"
    NORMAL = "normal"
    TURBO = "turbo"
    HYPER = "hyper"


class Street(StrEnum):
    """Betting round. Ordered; `order` gives the numeric value stored in ClickHouse."""

    PREFLOP = "preflop"
    FLOP = "flop"
    TURN = "turn"
    RIVER = "river"
    SHOWDOWN = "showdown"

    @property
    def order(self) -> int:
        """Numeric street index, matching the ClickHouse Enum8 encoding."""
        return _STREET_ORDER[self]


_STREET_ORDER: dict[Street, int] = {
    Street.PREFLOP: 0,
    Street.FLOP: 1,
    Street.TURN: 2,
    Street.RIVER: 3,
    Street.SHOWDOWN: 4,
}


class ActionType(StrEnum):
    """One decision or bookkeeping event in a hand.

    Blind and ante posts are actions too — they move chips — but they are NOT voluntary,
    which is the single distinction that makes VPIP correct. See `Action.is_voluntary`.
    """

    POST_SB = "post_sb"
    POST_BB = "post_bb"
    POST_ANTE = "post_ante"
    POST_STRADDLE = "post_straddle"
    POST_DEAD = "post_dead"
    FOLD = "fold"
    CHECK = "check"
    CALL = "call"
    BET = "bet"
    RAISE = "raise"
    ALLIN = "allin"
    SHOW = "show"
    MUCK = "muck"
    UNCALLED_RETURN = "uncalled_return"
    WIN = "win"

    @property
    def is_post(self) -> bool:
        """True for forced/blind postings, which never count as voluntary money."""
        return self in _POSTS

    @property
    def is_aggressive(self) -> bool:
        """True for bets and raises — the numerator of aggression stats."""
        return self in (ActionType.BET, ActionType.RAISE)

    @property
    def puts_money_in(self) -> bool:
        """True when the action adds chips to the pot."""
        return self in (ActionType.CALL, ActionType.BET, ActionType.RAISE) or self.is_post


_POSTS = frozenset(
    {
        ActionType.POST_SB,
        ActionType.POST_BB,
        ActionType.POST_ANTE,
        ActionType.POST_STRADDLE,
        ActionType.POST_DEAD,
    }
)


class Position(StrEnum):
    """Seat position relative to the button. Derived, never parsed — see `core.positions`."""

    BTN = "BTN"
    SB = "SB"
    BB = "BB"
    UTG = "UTG"
    UTG1 = "UTG1"
    UTG2 = "UTG2"
    MP = "MP"
    MP1 = "MP1"
    HJ = "HJ"
    CO = "CO"
    UNKNOWN = "UNKNOWN"

    @property
    def is_blind(self) -> bool:
        """True for the two blind positions."""
        return self in (Position.SB, Position.BB)

    @property
    def is_steal_seat(self) -> bool:
        """True for seats a first-in raise counts as a blind-steal attempt from."""
        return self in (Position.CO, Position.BTN, Position.SB)
