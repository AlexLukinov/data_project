"""The gate a node answer must pass before its numbers are shown (ADR-076, plan G.3).

A node's rows are decisions by players and the same player contributes many, so 100 rows are
not 100 observations: measured, a frequency's cluster-robust standard error is 2.14x the
binomial one, and at `MIN_N = 100` the old gate admitted frequencies whose 95% interval was
±21 points. The gate is therefore the **width of an interval**, and it follows the registry's
`Kind`:

  chosen  A frequency of what the seat did. `enough` means every action's interval, computed
          over per-player sums, is within `MAX_HALF_WIDTH` on its wider arm -- from at least
          `MIN_PLAYERS` players, because the variance of a handful of players is itself noise.
          `min_n` is what *this* node needs: the row count at which, at this node's own
          design effect, the binding action's interval meets the bar, so "240 of the 1,800
          needed" is a true sentence wherever it is printed and `enough` is
          `sample_size >= min_n` by construction. Under `MIN_N` rows nothing is measured yet
          and the requirement is the pool's typical one (`DEFAULT_DESIGN_EFFECT`).
  dealt   A sample of what the deck dealt -- a showdown range, a class bucket. Gated on a
          count, never scaled by a chosen stat's design effect.
"""

from __future__ import annotations

from dataclasses import dataclass

from stats.cluster import MIN_PLAYERS, needed
from stats.definitions import KIND_DEALT, Kind
from stats.interval import Interval, Level

MIN_N = 100
"""Observations a node needs before an interval is estimated at all. Below it the answer is a
count. It is the floor, not the gate: the gate is `MAX_HALF_WIDTH`."""

MAX_HALF_WIDTH = 0.05
"""The widest 95% interval a frequency may be shown with, as a share: ±5 points, measured on
the wider arm. At the pool's typical design effect and a frequency near 50% that is about
1,750 rows (ADR-076)."""

DEFAULT_DESIGN_EFFECT = 4.59
"""What a node needs before its own design effect is measurable: the pool's, from ADR-076
(556,112 decisions by 7,708 regs). Used only under `MIN_N`, so the requirement a thin node
prints is an estimate of the same thing a measured node prints, never a different number."""

LEVEL: Level = 95
"""The confidence level every node interval is computed at."""

WORST_CASE_SHARE = 0.5
"""The frequency whose interval is widest, used for the requirement under the floor."""


@dataclass(frozen=True, slots=True)
class Verdict:
    """Whether a node may show its frequencies, and what it would take."""

    enough: bool
    min_n: int
    """What this node needs: the rows at which the binding action's interval meets
    `MAX_HALF_WIDTH` at this node's design effect -- or the pool's typical one, under the floor."""
    players: int
    design_effect: float | None
    """The binding action's -- the one that needs the most rows -- when it was measured."""


def typical_requirement() -> int:
    """What a node needs before its own design effect is measurable.

    The pool's typical effect at the widest frequency -- about 1,750 rows -- so a thin node's
    `min_n` estimates the same thing a measured node's does.
    """
    return max(MIN_N, needed(WORST_CASE_SHARE, DEFAULT_DESIGN_EFFECT, MAX_HALF_WIDTH, LEVEL))


def requirement(frequency: float, span: Interval) -> int:
    """The rows one action needs for its wider arm to be within `MAX_HALF_WIDTH`.

    At the design effect its interval was computed with -- measured, or Kish's assumed one --
    which is `n / effective_n` either way.
    """
    effect = span.n / span.effective_n if span.effective_n else DEFAULT_DESIGN_EFFECT
    return needed(frequency, effect, MAX_HALF_WIDTH, span.level)


def verdict(
    total: int, frequencies: dict[str, float], intervals: dict[str, Interval], players: int
) -> Verdict:
    """The gate for a *chosen* frequency: every interval within the bar, or what it would take.

    `min_n` is the rows the binding action -- the one that needs the most -- requires, and
    `enough` is `total >= min_n`, so the two never disagree. Three things stop a node: fewer
    than `MIN_N` rows (nothing measured yet), fewer than `MIN_PLAYERS` players (the engine
    offers no interval at all), and a wider arm past `MAX_HALF_WIDTH` on some action.
    """
    if total < MIN_N or not intervals:
        return Verdict(
            enough=False, min_n=typical_requirement(), players=players, design_effect=None
        )
    name = max(intervals, key=lambda action: requirement(frequencies[action], intervals[action]))
    required = max(MIN_N, requirement(frequencies[name], intervals[name]))
    return Verdict(
        enough=total >= required and players >= MIN_PLAYERS,
        min_n=required,
        players=players,
        design_effect=intervals[name].design_effect,
    )


def count_verdict(total: int, floor: int = MIN_N) -> Verdict:
    """The gate for a *dealt* sample: a count, because the deck dealt it (`Kind`)."""
    return Verdict(enough=total >= floor, min_n=floor, players=0, design_effect=None)


def verdict_for(
    kind: Kind,
    total: int,
    frequencies: dict[str, float],
    intervals: dict[str, Interval],
    players: int = 0,
) -> Verdict:
    """The gate the registry's kind names: the interval's width for a choice, a count for a deal."""
    if kind == KIND_DEALT:
        return count_verdict(total)
    return verdict(total, frequencies, intervals, players)
