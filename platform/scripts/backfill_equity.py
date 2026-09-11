"""Fill `made_hand_*`, `allin_equity` and `ev_won_bb` on a corpus that was stored without them.

**Why this and not a re-parse.** `scripts/reparse.py` would also do it — enrichment now lives in
the shared ingest loop, so re-reading the raw text produces these columns by construction. But
everything this needs is already in the database: the board is five columns on `core.hands`, the
holdings and the money are on `core.hand_players`, and whether a hand went all-in is one
aggregate over `core.actions`. Reading 9M hands from object storage and re-running the parser to
recompute values that depend on none of it is forty-five minutes spent to change nothing except
the five columns this writes directly. It also keeps the parser out of it: a re-parse can move
any column, and the hero fingerprint is meant to be checked *against* this change, not through it.

**One implementation, two callers.** The money model is `core.allin.all_in_result`, which takes
plain values; this module supplies them from storage and the parse-time path supplies them from
a `CanonicalHand`. Neither has its own copy of the arithmetic.

**What costs time, and what makes it affordable.** A preflop all-in enumerates 1,712,304
runouts — 1.25 s. The real corpus holds ~64k of them, which is a day's work naively and
thirteen minutes once suits are folded together: `core.equity.canonical_key` reduces them to
~6.1k distinct matchups. Those are solved first, in a process pool, and the per-hand pass is
then a dictionary lookup. Flop, turn and river all-ins (990, 44 and 1 runouts) are not worth
pre-solving and are computed inline.

**Re-runnable.** Every core table is a `ReplacingMergeTree` keyed on `(user_id, hand_uid, seat)`
with `parsed_at` as the version, so a seat written twice collapses to the newer row. This writes
whole rows with a bumped `parsed_at`, never a partial update, and a month done twice converges.

    uv run python -m scripts.backfill_equity --dataset hero
    uv run python -m scripts.backfill_equity --dataset population --workers 8
    uv run python -m scripts.backfill_equity --month 2025-01        # one partition

**It dirties nothing by itself.** The incremental gate asks whether `core.hands.parsed_at` moved,
and this does not touch `core.hands`. The mart rebuild that follows therefore needs
`--rebuild-from`, exactly as `macros/incremental.sql` says for a bare `ALTER ADD COLUMN`:

    uv run python -m scripts.backfill --skip-tests --rebuild-from <first day of the corpus>
"""

from __future__ import annotations

import argparse
import logging
import pickle
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from decimal import Decimal
from pathlib import Path

from core.allin import HOLDEM_HOLE_CARDS, all_in_result
from core.cards import card_id
from core.classify import made_hand_of
from core.equity import (
    cache_size,
    canonical_spot,
    is_solved,
    pot_layers,
    remember_spot,
    restore,
    snapshot,
    solve_spot,
)
from scripts.equity_store import Hand, days, load, write

log = logging.getLogger("backfill_equity")

PREFLOP_RUNOUTS = 1_712_304

DEFAULT_CACHE = Path(__file__).resolve().parent.parent / ".equity-cache.pkl"
"""Where solved spots are kept between runs.

Pure derived data, gitignored: delete it and the next run rebuilds it, more slowly. It
exists because the enumeration is hours of work and a run that is interrupted — or split
across months — would otherwise pay for the same match-ups again. This is ADR-018's
"precomputed preflop equity table", built from what a corpus actually contains rather than
shipped whole."""


def fill_made_hands(hand: Hand) -> None:
    """The made-hand class on each street the board reached, for every seat with cards."""
    for seat in hand.seats:
        if len(seat.hole) != HOLDEM_HOLE_CARDS:
            continue
        for i, cards in enumerate((3, 4, 5)):
            if len(hand.board) >= cards:
                seat.made[i] = made_hand_of(seat.hole, hand.board[:cards])


def fill_ev(hand: Hand) -> None:
    """Equity and the all-in-adjusted result, through the same model the parser uses."""
    board = hand.board_at_all_in()
    if board is None:
        return
    contenders = hand.contenders()
    awarded = sum((s.net_won + s.invested for s in hand.seats), Decimal(0))
    results = all_in_result(
        [(hand.seats[i].hole[0], hand.seats[i].hole[1]) for i in contenders],
        board,
        [s.invested for s in hand.seats],
        contenders,
        awarded,
    )
    for index, (own, ev) in zip(contenders, results, strict=True):
        seat = hand.seats[index]
        seat.equity = own
        seat.ev_won_bb = (ev / hand.big_blind).quantize(Decimal("0.0001"))


Spot = tuple[tuple[tuple[str, ...], ...], tuple[tuple[int, ...], ...]]
"""A spot to enumerate: the contenders' holdings, and the eligible set of each pot layer."""


def preflop_spots(hands: list[Hand]) -> list[Spot]:
    """Every distinct preflop all-in spot this day needs and the memo does not yet hold.

    Solved before the per-hand pass so the 1.25 s enumerations happen once per *spot* and in
    parallel, rather than once per hand and in series. Suit relabelings and player order fold
    together, which is where the 10x comes from.

    Two spots per hand, not one, and the second is the one that was missed the first time
    round: `pot_shares` asks per pot LAYER, and a side pot is a different question on the same
    cards, so a three-way all-in for unequal stacks needs its layered spot warmed as well as
    the undivided one `allin_equity` reports. There are 2,797 of those in the corpus, and
    leaving them to the per-hand loop put an hour of single-threaded enumeration in the middle
    of an otherwise parallel pass.
    """
    seen: dict[tuple[object, ...], Spot] = {}
    for hand in hands:
        board = hand.board_at_all_in()
        if board is None or len(board) > 0:
            continue  # only an empty board — a preflop all-in — costs real time
        contenders = hand.contenders()
        holes = tuple(hand.seats[i].hole for i in contenders)
        ids = [(card_id(h[0]), card_id(h[1])) for h in holes]
        layers = pot_layers([float(s.invested) for s in hand.seats], contenders)
        everyone = (tuple(range(len(ids))),)
        for sets in (everyone, tuple(e for _, e in layers)):
            memo_key, _ = canonical_spot(ids, [], sets)
            if not is_solved(memo_key) and memo_key not in seen:
                seen[memo_key] = (holes, sets)
    return list(seen.values())


def _solve(spot: Spot) -> tuple[tuple[object, ...], tuple[tuple[float, ...], ...]]:
    """Worker entry point: solve one spot, keyed and ordered canonically."""
    holes, sets = spot
    return solve_spot([(card_id(h[0]), card_id(h[1])) for h in holes], [], sets)


def warm_cache(hands: list[Hand], pool: ProcessPoolExecutor | None) -> int:
    """Pre-solve this day's unsolved preflop matchups. Returns how many were solved.

    The pool is passed in rather than created here: spawning eight interpreters costs a few
    seconds on macOS, and over 142 days that is longer than some of the work it does.
    """
    spots = preflop_spots(hands)
    if not spots:
        return 0
    started = time.monotonic()
    if pool is None:
        for spot in spots:
            remember_spot(*_solve(spot))
    else:
        for key, rows in pool.map(_solve, spots, chunksize=4):
            remember_spot(key, rows)
    log.info(
        "  %d new preflop spots (%s runouts each) in %.0fs",
        len(spots),
        f"{PREFLOP_RUNOUTS:,}",
        time.monotonic() - started,
    )
    return len(spots)


def _enrich_day(dataset: str | None, name: str, pool: ProcessPoolExecutor | None) -> int:
    """Load, enrich and write one day. Returns the seats rewritten."""
    started = time.monotonic()
    hands = load(dataset, name)
    warm_cache(hands, pool)
    for hand in hands:
        fill_made_hands(hand)
        fill_ev(hand)
    written = write(hands, name, dataset)
    log.info(
        "%s — %s hands, %s seats rewritten, %.0fs (%d matchups cached)",
        name,
        f"{len(hands):,}",
        f"{written:,}",
        time.monotonic() - started,
        cache_size(),
    )
    return written


def load_cache(path: Path) -> None:
    """Restore solved spots from a previous run, if there are any."""
    if not path.exists():
        return
    with path.open("rb") as handle:
        log.info("restored %d solved spots from %s", restore(pickle.load(handle)), path.name)


def save_cache(path: Path) -> None:
    """Write the solved spots out, atomically, so an interrupted run loses nothing."""
    temporary = path.with_suffix(".tmp")
    with temporary.open("wb") as handle:
        pickle.dump(snapshot(), handle, protocol=pickle.HIGHEST_PROTOCOL)
    temporary.replace(path)


def run(dataset: str | None, month: str | None, workers: int, cache: Path) -> int:
    """Enrich every day in scope. Returns the number of seats rewritten."""
    pending = days(dataset, month)
    log.info("%d day(s) to enrich", len(pending))
    load_cache(cache)
    pool = ProcessPoolExecutor(max_workers=workers) if workers > 1 else None
    total = 0
    try:
        for name in pending:
            total += _enrich_day(dataset, name, pool)
            save_cache(cache)
    finally:
        if pool is not None:
            pool.shutdown()
    return total


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset", choices=("hero", "population"), help="default: both")
    ap.add_argument("--month", help="one partition, as YYYY-MM")
    ap.add_argument("--workers", type=int, default=8, help="processes for preflop enumeration")
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="solved-spot cache")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    started = time.monotonic()
    written = run(args.dataset, args.month, max(1, args.workers), args.cache)
    log.info("done — %s seats in %.0fs", f"{written:,}", time.monotonic() - started)
    log.info("now: uv run python -m scripts.backfill --skip-tests --rebuild-from <first day>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
