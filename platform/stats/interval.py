"""Confidence intervals for a report cell (plan E.2, ADR-040; spec §17).

Every number this product shows is a sample, and the sample size changes what the number
claims: **-1.37 bb/100 over 19,802 hands and -1.37 bb/100 over 200 hands are not the same
statement**, and a point estimate prints them identically. An `Interval` carries its own `n`,
so nothing downstream has to go looking for the sample size that produced it.

Two estimators, picked by the stat's format, because the two kinds of number are different
random variables:

  percent   A proportion: each row either did the thing or did not. **Wilson score interval**,
            not Wald. Wald (`p ± z·sqrt(p(1-p)/n)`) collapses to zero width at p = 0 and
            p = 1 -- "folded to a 4-bet 0% of the time, ±0.00, n = 3" -- which is precisely the
            case the founder needs warned about. Wilson never degenerates, never leaves
            [0, 1], and is asymmetric near the ends, which is the honest shape.

  per100    A mean of a signed, heavy-tailed, per-hand amount (big blinds won). The interval
            is the ordinary standard error of the mean, `sd / sqrt(n)`, carried through the
            stat's own 100x scaling. `sd` is the per-hand sample standard deviation, which
            `stats.query` asks ClickHouse for as `stddevSamp` alongside the value.

  ratio     **No interval.** In this registry `ratio` is the aggression factor,
            `(bets + raises) / calls`: two *disjoint* row sets, unbounded above, undefined at
            zero calls. It is not a proportion, so Wilson does not apply to it, and the error
            of a ratio of two counts is not the error of a mean. Plan E.2's sentence "ratio
            stats Wilson interval" means the `percent` format; the amendment is recorded in
            the step and in ADR-040.

  count     No interval. A count is the sample, not an estimate of something else.

**What both estimators assume, and where they are optimistic.** Both assume independent
draws. The rows are not independent: several decisions come from one hand, many hands come
from one session, and one session is played against a correlated pool. The true interval is
therefore *wider* than the one printed, by an amount the aggregates cannot reveal. This is a
floor on the uncertainty, not a ceiling -- a large improvement on the false precision of a
bare point estimate, and still not a licence to read the last decimal.
"""

from __future__ import annotations

import math
from typing import Literal

from stats.ast import _Strict
from stats.definitions import ROUNDING, Format

Level = Literal[90, 95, 99]
"""The confidence levels the engine offers, as whole percents."""

Z: dict[Level, float] = {
    90: 1.6448536269514722,
    95: 1.959963984540054,
    99: 2.5758293035489004,
}
"""Two-sided standard-normal quantiles, `z` such that `P(|Z| <= z) = level / 100`.

Tabulated rather than computed: the inverse normal CDF needs a numerical routine, the app venv
has no scipy or numpy on purpose (ADR-040), and three levels is the whole product need. The
values match `scipy.stats.norm.ppf(1 - (1 - level) / 2)` to every digit shown."""

DISPERSION_SUFFIX = "__sd"
"""The companion column a per-100 interval reads: the per-row sample standard deviation of the
column being summed. Emitted by `stats.query.stat_columns` only when a level was asked for."""

PERCENT_SCALE = 100.0
"""Both estimators work in the stat's own printed units, and both of those are 100x the
underlying quantity: a proportion printed as a percentage, a per-hand mean printed per 100
hands. One constant, two uses, and neither caller ever rescales an interval."""

MIN_N_PROPORTION = 1
"""Wilson is defined for a single trial; it simply comes back very wide, which is correct."""

MIN_N_MEAN = 30
"""Below this, a per-100 stat gets **no interval at all** rather than a confident-looking one.

Two observations are enough to compute `stddevSamp`, and that is the trap: the half-width uses a
normal quantile, and at small `n` the normal quantile is far too small. Against Student's `t` at
95%, `z` understates the band by **6.5x at n = 2**, 1.15x at n = 10 and 1.04x at n = 30 — and an
interval that is six times too narrow is not a conservative estimate, it is a wrong number wearing
the uniform of a careful one, which is the exact failure this step exists to prevent. Thirty is
where the approximation is worth having (it still understates by ~4%, and the module docstring
says the whole estimator is a floor). Below it the product does what it does everywhere else:
says nothing rather than something fabricated (spec §17)."""


class Interval(_Strict):
    """A confidence interval around a cell's value, in that cell's own printed units."""

    low: float
    """The lower bound. Rounded like the value, so the three numbers read as one statement."""
    high: float
    """The upper bound."""
    n: int
    """The sample size the interval was computed from, so no client has to guess it."""
    level: Level
    """The confidence level, as a whole percent."""
    method: Literal["wilson", "normal"]
    """`wilson` for a proportion, `normal` for the standard error of a mean."""


def proportion(value: float, n: int, level: Level) -> Interval | None:
    """The Wilson score interval for a percentage, in percentage points.

    `value` is the stat as the engine reports it (0..100), `n` the opportunity count behind
    it. Returns `None` when there is nothing to put an interval on.

        centre = (p + z²/2n) / (1 + z²/n)
        half   = z / (1 + z²/n) · sqrt( p(1-p)/n + z²/4n² )
    """
    if n < MIN_N_PROPORTION or not math.isfinite(value):
        return None
    p = min(max(value / PERCENT_SCALE, 0.0), 1.0)
    z = Z[level]
    z2 = z * z
    spread = 1.0 + z2 / n
    centre = (p + z2 / (2 * n)) / spread
    half = z / spread * math.sqrt(p * (1.0 - p) / n + z2 / (4 * n * n))
    return Interval(
        low=_rounded(PERCENT_SCALE * max(centre - half, 0.0), "percent"),
        high=_rounded(PERCENT_SCALE * min(centre + half, 1.0), "percent"),
        n=n,
        level=level,
        method="wilson",
    )


def mean(value: float, sd: float, n: int, level: Level) -> Interval | None:
    """The standard-error interval around a per-100 stat, in the same per-100 units.

    `value` is `100 · mean(x)` and `sd` the per-row sample standard deviation of the same `x`
    in its own units (big blinds per hand), so the half-width carries the same factor:

        half = 100 · z · sd / sqrt(n)

    Symmetric by construction, which is what makes "value ± band" an honest rendering here
    and a lossy one for a proportion.
    """
    if n < MIN_N_MEAN or not math.isfinite(value) or not math.isfinite(sd) or sd < 0.0:
        return None
    half = PERCENT_SCALE * Z[level] * sd / math.sqrt(n)
    return Interval(
        low=_rounded(value - half, "per100"),
        high=_rounded(value + half, "per100"),
        n=n,
        level=level,
        method="normal",
    )


def for_cell(
    fmt: Format, value: float | None, n: int, sd: float | None, level: Level
) -> Interval | None:
    """The interval for one cell, or `None` when this format does not have one.

    The one place the format-to-estimator mapping is written down; `ratio` and `count` fall
    through to `None` deliberately (see the module docstring).
    """
    if value is None:
        return None
    if fmt == "percent":
        return proportion(value, n, level)
    if fmt == "per100" and sd is not None:
        return mean(value, sd, n, level)
    return None


def _rounded(value: float, fmt: Format) -> float:
    """A bound rounded exactly as the value it brackets is rounded."""
    return round(value, ROUNDING[fmt])
