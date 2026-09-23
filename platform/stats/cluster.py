"""Cluster-robust intervals: a pool stat whose rows are decisions by players (ADR-076, G.3).

A population frequency is `X / N` over decision rows, and the binomial interval treats the
`N` rows as independent draws. They are not: the same player contributes many of them, and
whether a player folds is a stable trait, so their rows repeat. Measured on the BB facing a
flop c-bet in a single-raised pot, regs only -- 556,112 decisions by 7,708 players -- the
standard error clustered on the player is **0.143pp** against a binomial **0.067pp**: a design
effect of **4.59**. `MIN_N = 100` therefore admitted a frequency whose 95% interval was about
±21 points while the answer said `enough`.

The estimator is the ratio estimator's, clustered on the player. With per-player sums
`n_i` (rows) and `x_i` (rows that did the thing), `p = X / N`, and `K` players:

    S      = Σ (x_i - p·n_i)²  =  Σx_i² - 2p·Σx_i·n_i + p²·Σn_i²
    Var_c  = K/(K-1) · S / N²                 (cluster-robust)
    Var_b  = p(1-p) / N                       (binomial)
    DEFF   = Var_c / Var_b, floored at 1      (design effect)

Everything the interval needs is those sums and `K`, which is what the two-level query in
`stats.cluster_query` returns per group -- never a row per player. The interval itself is
**Wilson on the effective sample** `N / DEFF`, so it keeps Wilson's shape at the ends and
never collapses to zero width (the reason Wald was rejected in plan E.2).

Two things the sums cannot always give, and what is done instead:

*The design effect cannot be measured* with fewer than two players, or when nothing varied
(`p` at 0 or 1, so `Var_b = 0`). The worst case is then assumed -- every player a constant,
an intra-class correlation of 1 -- under which the variance is `Var_b · Σn_i² / N²`, so the
effective sample is Kish's effective number of clusters, `N² / Σn_i²`. That is at most `K`,
and equal to it only when every player contributed the same number of rows; a node one
whale has played 300 times is one observation. No design effect is reported in that case,
because none was measured.

*Too few players make the variance estimate itself noise*: the `K/(K-1)` linearisation is
biased low at small `K`, and the normal quantile understates Student's t by 42% at K = 5 and
4% at K = 30. Under `MIN_PLAYERS` there is no interval at all, for a proportion and a mean
alike -- the same rule `stats.interval.MIN_N_MEAN` applies to rows, applied here to the
independent units, which are the players.

The registry's `Kind` does not change the estimator: a dealt stat's design effect is measured
too (1.3-1.4 on the 169 classes at the node above, not 1 -- who arrives at a node is selected
by their choices), and it is floored at 1, so an independent sample pays nothing. The kind
picks the *gate* (`analysis.pool.node_gate`).
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from stats.definitions import Format
from stats.interval import (
    MIN_N_MEAN,
    PERCENT_SCALE,
    Interval,
    Level,
    Z,
    rounded_like,
    wilson,
)

NUMERATOR_SUFFIX = "__x"
PLAYERS_SUFFIX = "__k"
SQUARES_SUFFIX = "__xx"
CROSS_SUFFIX = "__xn"
SIZES_SUFFIX = "__nn"
CLUSTER_SUFFIXES = (NUMERATOR_SUFFIX, PLAYERS_SUFFIX, SQUARES_SUFFIX, CROSS_SUFFIX, SIZES_SUFFIX)
"""The columns a clustered stat carries beside `<code>` and `<code>__n`: the numerator sum,
the players with at least one opportunity, and the three sums of squares. Emitted by
`stats.cluster_query.clustered_columns`, read back by `ClusterSums.from_record`."""

MIN_CLUSTERS = 2
"""Players a cluster-robust variance can be computed from at all: `K/(K-1)` needs two."""

MIN_PLAYERS = MIN_N_MEAN
"""Players an interval needs before one is offered. `stats.interval.MIN_N_MEAN`'s reasoning
-- the normal quantile is far too small for a handful of independent units -- with the
players as the units."""

DESIGN_EFFECT_DIGITS = 3
EFFECTIVE_DIGITS = 1


@dataclass(frozen=True, slots=True)
class ClusterSums:
    """The per-player sums of one stat in one group, already summed over players."""

    players: int
    """`K`: players with at least one opportunity."""
    n: float
    """`N = Σn_i`: the rows."""
    x: float
    """`X = Σx_i`: the numerator -- rows that did the thing, or big blinds won."""
    squares: float
    """`Σx_i²`."""
    cross: float
    """`Σx_i·n_i`."""
    sizes: float
    """`Σn_i²`."""

    @classmethod
    def from_record(cls, code: str, record: Mapping[str, Any]) -> ClusterSums | None:
        """The sums for `code` from one result row, or None when the query did not carry them."""
        found = _present(record, [f"{code}__n", *(f"{code}{s}" for s in CLUSTER_SUFFIXES)])
        if found is None:
            return None
        n, x, players, squares, cross, sizes = found
        return cls(
            players=int(players),
            n=float(n),
            x=float(x),
            squares=float(squares),
            cross=float(cross),
            sizes=float(sizes),
        )

    @property
    def ratio(self) -> float | None:
        """`X / N`, the estimate itself; None with no rows."""
        return self.x / self.n if self.n > 0 else None

    def variance(self) -> float | None:
        """The ratio estimator's cluster-robust variance of `X / N`; None under two players."""
        p = self.ratio
        if p is None or self.players < MIN_CLUSTERS:
            return None
        spread = max(self.squares - 2.0 * p * self.cross + p * p * self.sizes, 0.0)
        return self.players / (self.players - 1) * spread / (self.n * self.n)

    def binomial_variance(self) -> float | None:
        """`p(1-p)/N`; None with no rows, and zero where nothing varied."""
        p = self.ratio
        return None if p is None else p * (1.0 - p) / self.n

    def design_effect(self) -> float | None:
        """`Var_c / Var_b`, never below 1; None when either side is undefined."""
        clustered, binomial = self.variance(), self.binomial_variance()
        if clustered is None or binomial is None or binomial <= 0.0:
            return None
        return max(1.0, clustered / binomial)

    def effective(self) -> tuple[float, float | None]:
        """(effective sample, measured design effect): `N / DEFF`, or Kish's clusters and None.

        The fallback is the worst case -- every player a constant -- under which the
        effective sample is `N² / Σn_i²`; nothing was measured, so no effect is reported.
        """
        measured = self.design_effect()
        if measured is not None:
            return self.n / measured, measured
        if self.sizes <= 0.0:
            return 0.0, None
        return self.n * self.n / self.sizes, None


def _present(record: Mapping[str, Any], keys: list[str]) -> list[Any] | None:
    """The values under `keys`, or None if any is missing: a row without its cluster columns."""
    values = [record.get(key) for key in keys]
    return None if any(value is None for value in values) else values


def proportion_by_player(sums: ClusterSums, level: Level) -> Interval | None:
    """The clustered Wilson interval of a percentage, in percentage points.

    None under `MIN_PLAYERS`, for the reason in the module docstring, and with no rows.
    """
    if sums.ratio is None or sums.players < MIN_PLAYERS:
        return None
    # Clipped like the flat estimator: a custom numerator need not be a subset of its
    # denominator, and Wilson's square root is undefined past 1.
    p = min(max(sums.ratio, 0.0), 1.0)
    effective_n, design_effect = sums.effective()
    if effective_n <= 0.0:
        return None
    centre, half = wilson(p, effective_n, Z[level])
    return Interval(
        low=rounded_like(PERCENT_SCALE * max(centre - half, 0.0), "percent"),
        high=rounded_like(PERCENT_SCALE * min(centre + half, 1.0), "percent"),
        n=int(sums.n),
        level=level,
        method="cluster",
        players=sums.players,
        effective_n=round(effective_n, EFFECTIVE_DIGITS),
        design_effect=_rounded_effect(design_effect),
    )


def mean_by_player(value: float, sums: ClusterSums, level: Level) -> Interval | None:
    """The clustered standard-error interval of a per-100 mean, in per-100 units.

    No design effect is reported -- it would need the per-row spread, which a per-player sum
    has thrown away -- and no effective sample for the same reason.
    """
    variance = sums.variance()
    if sums.players < MIN_PLAYERS or variance is None or not math.isfinite(value):
        return None
    half = PERCENT_SCALE * Z[level] * math.sqrt(variance)
    return Interval(
        low=rounded_like(value - half, "per100"),
        high=rounded_like(value + half, "per100"),
        n=int(sums.n),
        level=level,
        method="cluster",
        players=sums.players,
    )


def wilson_arm(p: float, n: float, z: float) -> float:
    """The wider arm of the Wilson interval around `p`, clipped to [0, 1].

    Wilson is asymmetric, so "p, ±band" is true on both sides only when the band is the
    wider arm; at p = 1 that is the whole lower arm, twice the symmetric half-width. It
    falls as `n` grows, which is what `needed` bisects on.
    """
    centre, half = wilson(p, n, z)
    return max(p - max(centre - half, 0.0), min(centre + half, 1.0) - p)


def needed(p: float, design_effect: float, half_width: float, level: Level) -> int:
    """The smallest sample whose wider Wilson arm at `p` is within `half_width`.

    Bisection on the effective sample, then scaled back up by the design effect and rounded
    up: *at this design effect*, this many rows would make the claim. An estimate, not a
    promise -- a node that grows by the same players playing more hands raises its design
    effect as it grows, and shrinks its interval less than this says; one that grows by new
    players shrinks it as promised. `half_width` and `p` are fractions of 1.
    """
    z = Z[level]
    low, high = 1.0, 1.0
    while wilson_arm(p, high, z) > half_width and high < 1e12:
        high *= 2.0
    for _ in range(64):
        middle = (low + high) / 2.0
        if wilson_arm(p, middle, z) > half_width:
            low = middle
        else:
            high = middle
    return math.ceil(high * design_effect)


def for_cell(
    fmt: Format, value: float | None, code: str, record: Mapping[str, Any], level: Level
) -> Interval | None:
    """The interval for one cell of a clustered report, or None where there is none.

    A proportion and a per-100 mean are clustered; a ratio and a count have no interval, as
    ever (`stats.interval`).
    """
    if value is None:
        return None
    sums = ClusterSums.from_record(code, record)
    if sums is None:
        return None
    if fmt == "percent":
        return proportion_by_player(sums, level)
    if fmt == "per100":
        return mean_by_player(value, sums, level)
    return None


def _rounded_effect(design_effect: float | None) -> float | None:
    return None if design_effect is None else round(design_effect, DESIGN_EFFECT_DIGITS)
