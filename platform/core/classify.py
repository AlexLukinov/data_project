"""Made-hand classification against a board — the Python twin of `poker-core/src/classify.ts`.

**Why a twin and not a port of convenience.** `marts.decisions.made_hand` is written by this
module at parse time; the Range Lab's distribution and blocker panels bucket the *same* concept
in the browser with `classifyMadeHand`. If the two ever disagree, a player's own hand would sit
in one class in the mart and another on screen, and no test anywhere would notice. They are
therefore pinned to one shared fixture, `tests/fixtures/made_hands.json`, parsed by both suites
— the pattern ADR-028/ADR-031 already use for `NodeKey`.

The classes are RELATIVE to the board, as Flopzilla and GTO Wizard bucket them: a board that
pairs itself does not hand every player "a pair". The rule, in order: take the absolute category
of hole cards + board; if it is a straight or better *and the hole cards improve on what the
board makes by itself*, that category is the class. Otherwise the class comes from how the hole
cards touch the board — set vs trips, both cards paired, which board card is paired, a pocket
pair over or under the board — and finally ace-high / king-high / nothing.

Ranks come from `phevaluator` (Apache-2.0, PokerHandEvaluator — the same upstream the
TypeScript side runs through WebAssembly, ADR-027). Its rank space is Cactus-Kev: 1 = royal
flush … 7462 = 7-5-4-3-2, lower is stronger. That is byte-for-byte the space
`evaluator/types.ts` documents, which is what makes the two implementations comparable at all.
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import IntEnum

from phevaluator.evaluator import evaluate_cards

from core.cards import ACE, KING, card_id, rank_of

MadeHand = str
"""One of `MADE_HAND_CLASSES`. A bare `str` rather than an enum because it is written straight
into a `LowCardinality(String)` column and read back as text by the API and the UI."""

MADE_HAND_CLASSES: tuple[MadeHand, ...] = (
    "straight_flush",
    "quads",
    "full_house",
    "flush",
    "straight",
    "set",
    "trips",
    "two_pair",
    "overpair",
    "top_pair",
    "under_pair",
    "second_pair",
    "third_pair",
    "weak_pair",
    "ace_high",
    "king_high",
    "no_pair",
)
"""Strongest first, exactly `MADE_HAND_CLASSES` in classify.ts. The order is the contract: the
UI renders distributions in it, so a reordering here silently reorders the panels."""

UNKNOWN: MadeHand = ""
"""No hole cards, or no board yet. Stored as the empty string, never as a class name — a
decision with no cards showing must not look like "no pair"."""

FLOP_CARDS = 3
RIVER_CARDS = 5


class Category(IntEnum):
    """Absolute hand categories, weakest first — the ordering of `Category` in types.ts."""

    HIGH_CARD = 0
    PAIR = 1
    TWO_PAIR = 2
    TRIPS = 3
    STRAIGHT = 4
    FLUSH = 5
    FULL_HOUSE = 6
    QUADS = 7
    STRAIGHT_FLUSH = 8


_RANK_BASE = (
    (11, Category.STRAIGHT_FLUSH),
    (167, Category.QUADS),
    (323, Category.FULL_HOUSE),
    (1600, Category.FLUSH),
    (1610, Category.STRAIGHT),
    (2468, Category.TRIPS),
    (3326, Category.TWO_PAIR),
    (6186, Category.PAIR),
)
"""`(first rank NOT in the category, category)`, strongest first — `RANK_BASE` in types.ts."""

_BIG_CATEGORY_CLASS: dict[Category, MadeHand] = {
    Category.STRAIGHT_FLUSH: "straight_flush",
    Category.QUADS: "quads",
    Category.FULL_HOUSE: "full_house",
    Category.FLUSH: "flush",
    Category.STRAIGHT: "straight",
}


def category_of_rank(rank: int) -> Category:
    """The category a Cactus-Kev rank belongs to."""
    for limit, category in _RANK_BASE:
        if rank < limit:
            return category
    return Category.HIGH_CARD


def _board_category(board: Sequence[int]) -> Category:
    """Category of the board by itself. A 3- or 4-card board cannot hold a straight or flush."""
    if len(board) >= RIVER_CARDS:
        return category_of_rank(evaluate_cards(*board))
    counts = [0] * 13
    for c in board:
        counts[rank_of(c)] += 1
    pairs = counts.count(2)
    if 4 in counts:
        return Category.QUADS
    if 3 in counts:
        return Category.TRIPS
    if pairs >= 2:
        return Category.TWO_PAIR
    return Category.PAIR if pairs == 1 else Category.HIGH_CARD


def _paired_class(hole: tuple[int, int], board: Sequence[int], board_ranks: list[int]) -> MadeHand:
    """The class of a pocket pair: quads, a set, or a pair over/under the board."""
    on_board = sum(1 for c in board if rank_of(c) == rank_of(hole[0]))
    if on_board >= 2:
        return "quads"
    if on_board == 1:
        return "set"
    return "overpair" if rank_of(hole[0]) > board_ranks[0] else "under_pair"


def _one_hit_class(hit: int, board: Sequence[int], board_ranks: list[int]) -> MadeHand:
    """The class when exactly one hole-card rank appears on the board."""
    on_board = sum(1 for c in board if rank_of(c) == hit)
    if on_board == 3:
        return "quads"
    if on_board == 2:
        return "trips"
    position = board_ranks.index(hit)
    if position == 0:
        return "top_pair"
    if position == 1:
        return "second_pair"
    if position == 2:
        return "third_pair"
    return "weak_pair"


def _classify_by_pairs(hole: tuple[int, int], board: Sequence[int]) -> MadeHand:
    """How the hole cards touch the board, once "straight or better" has been ruled out."""
    r0, r1 = rank_of(hole[0]), rank_of(hole[1])
    board_ranks = sorted({rank_of(c) for c in board}, reverse=True)
    if r0 == r1:
        return _paired_class(hole, board, board_ranks)
    hits = [r for r in (r0, r1) if any(rank_of(c) == r for c in board)]
    if len(hits) == 2:
        return "two_pair"
    if len(hits) == 1:
        return _one_hit_class(hits[0], board, board_ranks)
    high = max(r0, r1)
    if high == ACE:
        return "ace_high"
    if high == KING:
        return "king_high"
    return "no_pair"


def classify_made_hand(hole: Sequence[int], board: Sequence[int]) -> MadeHand:
    """The made-hand class of two hole cards on a 3-5 card board.

    Mirrors `classifyMadeHand` in classify.ts branch for branch. One branch of the original is
    deliberately absent: its `board.length < RIVER && category > boardOnly` test can only be
    reached after `category > boardOnly` has already returned, so it is unreachable there and
    would be dead code here.
    """
    if not FLOP_CARDS <= len(board) <= RIVER_CARDS:
        raise ValueError(f"a board has 3 to 5 cards, got {len(board)}")
    if len(hole) != 2:
        raise ValueError(f"a hold'em holding is two cards, got {len(hole)}")
    pair = (hole[0], hole[1])
    rank = evaluate_cards(*pair, *board)
    category = category_of_rank(rank)
    big = _BIG_CATEGORY_CLASS.get(category)
    if big is not None:
        board_only = _board_category(board)
        if category > board_only:
            return big
        # Same category as the board alone: the hole cards count only if they beat it outright
        # (holding the ace of a four-flush on the river, say).
        if len(board) == RIVER_CARDS and rank < evaluate_cards(*board):
            return big
    return _classify_by_pairs(pair, board)


def made_hand_of(hole_cards: Sequence[str], board: Sequence[str]) -> MadeHand:
    """Class from card strings, or `UNKNOWN` when it cannot be asked.

    The two "cannot be asked" cases are genuinely different from a weak hand and must stay
    distinguishable downstream: cards not shown (pool hands away from showdown) and no board
    yet (every preflop decision, where `hand_class` already carries the 169-class vocabulary).
    Anything that is not a two-card hold'em holding — PLO, stud, a partial deal — is also
    `UNKNOWN` rather than a wrong answer.
    """
    if len(hole_cards) != 2 or not FLOP_CARDS <= len(board) <= RIVER_CARDS:
        return UNKNOWN
    return classify_made_hand(parse_two(hole_cards), [card_id(c) for c in board])


def parse_two(cards: Sequence[str]) -> tuple[int, int]:
    """Exactly two card strings → ids."""
    return (card_id(cards[0]), card_id(cards[1]))
