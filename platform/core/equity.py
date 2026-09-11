"""Exact all-in equity by enumeration, with side pots handled per pot rather than per player.

**Exact, not sampled.** Every runout is enumerated: 1 board for a river all-in, 44 for a turn,
990 for a flop, and 1,712,304 for a heads-up preflop one. Measured on the founder's Mac, a full
preflop matchup is **1.25 s** — `phevaluator` answers a 7-card hand in 376 ns — so the whole
corpus is tractable without a sampled shortcut, and an EV number that moves when you recompute
it is not a number a player can trust.

What makes the preflop case affordable is that a matchup is only expensive *once*: suits are
interchangeable, so `canonical_key` relabels them to a fixed form and the answer is memoized
against it. The real corpus holds 60,709 heads-up preflop all-ins that reduce to **6,131**
distinct matchups — a 10x saving, and the difference between two hours and thirteen minutes.

**Side pots are settled per pot, which is the whole reason this module is not one `equity()`
call.** ADR-018 flagged it: with three players and unequal stacks, "equity against the field" is
not anybody's share of anything. A short stack that is only eligible for the main pot cannot win
the side pot however good its hand is, so each pot layer is awarded separately, to the best hand
among the players eligible for *that* layer. Where the layers turn out to have identical
eligible sets — which is the usual case, dead money from a folder being the common cause — they
are merged first, so the ordinary heads-up all-in takes the single-pot path.

Dead cards are the contenders' holdings and the board, and nothing else: see
`core.cards.remaining_deck` for why a revealed muck is deliberately not excluded.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from itertools import combinations, permutations

from phevaluator.evaluator import evaluate_7cards

from core.cards import remaining_deck, suit_of

Hole = tuple[int, int]
"""One player's two hole cards, as `card_id` integers."""

Layer = tuple[float, tuple[int, ...]]
"""One pot layer: its size, and the indices of the contenders eligible to win it."""

BOARD_CARDS = 5
_SUIT_MAPS: tuple[tuple[int, ...], ...] = tuple(tuple(p) for p in permutations(range(4)))
"""The 24 suit relabelings. Suits carry no value in hold'em, so every one of them maps a spot
onto an equivalent spot — which is what makes a canonical form possible."""

_MEMO: dict[tuple[object, ...], tuple[tuple[float, ...], ...]] = {}
"""Win probabilities per layer, keyed by canonical spot + eligibility. Bounded in practice by
the number of distinct matchups a corpus contains, ~6k for the real one."""


def _relabel(card: int, suit_map: Sequence[int]) -> int:
    """The same rank, with its suit renamed."""
    return (card & ~3) | suit_map[suit_of(card)]


def canonical_key(
    holes: Sequence[Hole], board: Sequence[int]
) -> tuple[tuple[object, ...], tuple[int, ...]]:
    """A suit- and player-independent key for this spot, plus the player order it assumes.

    Returns `(key, order)` where `order[i]` is the caller's index of the i-th player in the
    key. Two spots sharing a key have the same equities *in key order*, so a cached answer is
    read back through `order`. Players are sorted as well as suits because AA vs KK and KK vs
    AA are one calculation.
    """
    best: tuple[object, ...] | None = None
    best_order: tuple[int, ...] = ()
    for suit_map in _SUIT_MAPS:
        mapped = [tuple(sorted(_relabel(c, suit_map) for c in h)) for h in holes]
        order = tuple(sorted(range(len(holes)), key=lambda i: mapped[i]))
        key = (
            tuple(mapped[i] for i in order),
            tuple(sorted(_relabel(c, suit_map) for c in board)),
        )
        if best is None or key < best:
            best, best_order = key, order
    return best or (), best_order


def merge_layers(layers: Sequence[Layer]) -> list[Layer]:
    """Collapse layers that the same players are eligible for.

    A folder's dead money splits the pot into levels that nobody's eligibility distinguishes,
    so without this the ordinary two-player all-in would take the general path for no reason.
    """
    merged: dict[tuple[int, ...], float] = {}
    for amount, eligible in layers:
        merged[eligible] = merged.get(eligible, 0.0) + amount
    return [(amount, eligible) for eligible, amount in merged.items() if amount > 0]


def pot_layers(contributions: Sequence[float], contenders: Sequence[int]) -> list[Layer]:
    """Split the money into side-pot layers from what each seat put in.

    `contributions` is indexed by seat position in the caller's own list and includes players
    who folded — their chips are in the pot and are won by somebody, they just cannot be the
    one to win them. `contenders` names the seats still holding cards, as indices into the
    same list; the layers returned index the *contender* list, which is what the enumeration
    works in.
    """
    live = {seat: i for i, seat in enumerate(contenders)}
    levels = sorted({c for c in contributions if c > 0})
    layers: list[Layer] = []
    previous = 0.0
    for level in levels:
        amount = sum(min(c, level) - min(c, previous) for c in contributions)
        eligible = tuple(live[s] for s in contenders if contributions[s] >= level)
        if amount > 0 and eligible:
            layers.append((amount, eligible))
        previous = level
    return merge_layers(layers)


def _tally(
    holes: Sequence[Hole], board: Sequence[int], eligible_sets: Sequence[tuple[int, ...]]
) -> tuple[list[list[float]], int]:
    """Enumerate every runout once, accumulating each layer's wins. Ties split the layer."""
    n = len(holes)
    won = [[0.0] * n for _ in eligible_sets]
    dead = [c for h in holes for c in h] + list(board)
    deck = remaining_deck(dead)
    fixed = tuple(board)
    boards = 0
    for extra in combinations(deck, BOARD_CARDS - len(fixed)):
        full = fixed + extra
        ranks = [evaluate_7cards(h[0], h[1], *full) for h in holes]
        boards += 1
        for layer, eligible in enumerate(eligible_sets):
            best = min(ranks[i] for i in eligible)
            winners = [i for i in eligible if ranks[i] == best]
            share = 1.0 / len(winners)
            row = won[layer]
            for i in winners:
                row[i] += share
    return won, boards


def canonical_spot(
    holes: Sequence[Hole], board: Sequence[int], eligible_sets: Sequence[tuple[int, ...]]
) -> tuple[tuple[object, ...], tuple[int, ...]]:
    """The memo key for a whole spot — cards *and* eligibility — plus its player order.

    Eligibility is part of the key because the answer is: a side pot only two of three players
    can win is a different question from the main pot all three can, on the same cards.
    """
    key, order = canonical_key(holes, board)
    position = {caller: i for i, caller in enumerate(order)}
    canonical_sets = tuple(tuple(sorted(position[i] for i in e)) for e in eligible_sets)
    return (*key, canonical_sets), order


def win_probabilities(
    holes: Sequence[Hole], board: Sequence[int], eligible_sets: Sequence[tuple[int, ...]]
) -> tuple[tuple[float, ...], ...]:
    """Each player's probability of winning each layer, memoized by canonical spot."""
    memo_key, order = canonical_spot(holes, board, eligible_sets)
    position = {caller: i for i, caller in enumerate(order)}
    cached = _MEMO.get(memo_key)
    if cached is None:
        won, boards = _tally([holes[i] for i in order], board, memo_key[-1])  # type: ignore[arg-type]
        cached = tuple(tuple(w / boards for w in row) for row in won)
        _MEMO[memo_key] = cached
    return tuple(tuple(row[position[i]] for i in range(len(holes))) for row in cached)


def pot_shares(
    holes: Sequence[Hole], board: Sequence[int], layers: Sequence[Layer]
) -> tuple[float, ...]:
    """Each contender's expected share of all the money in `layers`, summing to 1."""
    if not layers:
        raise ValueError("an all-in spot has at least one pot layer")
    probabilities = win_probabilities(holes, board, [e for _, e in layers])
    total = sum(amount for amount, _ in layers)
    shares = [0.0] * len(holes)
    for (amount, _), row in zip(layers, probabilities, strict=True):
        for i, p in enumerate(row):
            shares[i] += amount * p / total
    return tuple(shares)


def equity(holes: Sequence[Hole], board: Sequence[int]) -> tuple[float, ...]:
    """Plain equity in one undivided pot — what a player means by "I was 80% to win"."""
    everyone = tuple(range(len(holes)))
    return win_probabilities(holes, board, [everyone])[0]


def solve_spot(
    holes: Sequence[Hole], board: Sequence[int], eligible_sets: Sequence[tuple[int, ...]]
) -> tuple[tuple[object, ...], tuple[tuple[float, ...], ...]]:
    """Solve a spot and return `(memo key, rows IN KEY ORDER)` for `remember_spot`.

    `solve_spot` / `remember_spot` / `is_solved` are how a worker process hands a solved spot
    back to the parent. The values must travel in the key's own player order, not the caller's,
    or a cached answer would later be read against the wrong seat — the one kind of error in
    this module that produces entirely plausible numbers.
    """
    memo_key, order = canonical_spot(holes, board, eligible_sets)
    won, boards = _tally([holes[i] for i in order], board, memo_key[-1])  # type: ignore[arg-type]
    return memo_key, tuple(tuple(w / boards for w in row) for row in won)


def remember_spot(memo_key: tuple[object, ...], rows: tuple[tuple[float, ...], ...]) -> None:
    """Seed the memo with a spot solved elsewhere."""
    _MEMO[memo_key] = rows


def is_solved(memo_key: tuple[object, ...]) -> bool:
    """Whether the memo already holds this spot.

    Lets a caller that batches work — `scripts.backfill_equity` solving a day's spots in a
    process pool — skip the ones an earlier batch already paid for. Without it the corpus's
    common match-ups would be re-enumerated once per day, which is most of the total cost.
    """
    return memo_key in _MEMO


def cache_size() -> int:
    """How many distinct matchups have been solved. Reported by the backfill's progress log."""
    return len(_MEMO)


def snapshot() -> dict[tuple[object, ...], tuple[tuple[float, ...], ...]]:
    """Every solved spot, for a caller that wants to keep them beyond this process.

    The memo is the expensive thing in this module — hours of enumeration — and losing it to a
    restart means paying for it again. `snapshot`/`restore` let `scripts.backfill_equity` keep
    it on disk between runs. It is pure derived data: delete the file and the next run rebuilds
    it, more slowly. Storage is the caller's business, so nothing here touches the filesystem.
    """
    return dict(_MEMO)


def restore(entries: Mapping[tuple[object, ...], tuple[tuple[float, ...], ...]]) -> int:
    """Merge previously solved spots into the memo. Returns the new size."""
    _MEMO.update(entries)
    return len(_MEMO)
