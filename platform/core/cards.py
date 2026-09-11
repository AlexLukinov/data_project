"""Card notation — `'Ac'` in, integer indices out.

The integer form is PokerHandEvaluator's own: `rank * 4 + suit`, rank 0 = deuce … 12 = ace,
suit 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades. It is built here arithmetically rather
than through `phevaluator.Card`, whose constructor parses a string and allocates an object:
the equity enumeration calls the evaluator ~3.4 million times for a single preflop all-in, so
a per-card allocation there is the difference between one second and one minute.

`core.classify` and `core.equity` are the two consumers. Both are pure functions of cards, so
this module imports nothing from the rest of the platform.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

RANKS = "23456789TJQKA"
"""Index is the rank value: 0 = deuce … 12 = ace. The order the evaluator's tables assume."""

SUITS = "cdhs"
"""Index is the suit value. Suits are interchangeable in every calculation here; the order
only has to be *stable*, so that a canonical form is reproducible across processes."""

ACE = 12
KING = 11

DECK: tuple[str, ...] = tuple(r + s for r in RANKS for s in SUITS)
"""All 52 cards in `card_id` order, so `DECK[card_id(c)] == c`."""


class CardError(ValueError):
    """A card string that is not two characters of rank + suit.

    Loud on purpose: a silently-skipped card would produce a plausible-looking equity for the
    wrong hand, which is worse than no number at all.
    """


def card_id(card: str) -> int:
    """`'Ac'` → 48. Raises `CardError` on anything that is not a real card."""
    if len(card) != 2:
        raise CardError(f"a card is two characters, got {card!r}")
    rank = RANKS.find(card[0])
    suit = SUITS.find(card[1])
    if rank < 0 or suit < 0:
        raise CardError(f"not a card: {card!r}")
    return rank * 4 + suit


def rank_of(card_index: int) -> int:
    """0 = deuce … 12 = ace."""
    return card_index >> 2


def suit_of(card_index: int) -> int:
    """0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades."""
    return card_index & 3


def parse_cards(cards: Iterable[str]) -> tuple[int, ...]:
    """Card strings → ids, in the order given."""
    return tuple(card_id(c) for c in cards)


def split_cards(text: str) -> tuple[str, ...]:
    """`'Ac Kd'` → `('Ac', 'Kd')`; empty text → `()`.

    This is the storage form: `core.hand_players.hole_cards` is a space-joined string, and
    "unknown" is the empty string rather than NULL.
    """
    return tuple(text.split()) if text else ()


def remaining_deck(dead: Sequence[int]) -> list[int]:
    """Every card not in `dead`, in deck order.

    `dead` is the cards *visible in this calculation* — the contenders' holdings and the board.
    Deliberately NOT the folded players' cards, even when the file happens to reveal them: an
    equity that changes depending on whether an opponent's muck was printed is not comparable
    with any other tracker's, and hero exports print cards that pool exports do not.
    """
    seen = set(dead)
    return [c for c in range(52) if c not in seen]
