"""Confidence intervals: every formula against a value worked by hand (plan E.2, spec §17).

Spec §17: "Every §8 formula gets a unit test with a hand-worked expected value. I will make
real money decisions from these numbers." The expected values below were derived from the
textbook formulas -- Wilson (1927) for a proportion, `sd / sqrt(n)` for a mean -- with the
arithmetic in a trailing comment, not by running the module and pasting what it said. The
Wilson figures for 50/100, 0/10 and 0/3 are the published ones.
"""

from __future__ import annotations

import math

from stats.interval import MIN_N_MEAN, Z, for_cell, mean, proportion


def test_wilson_on_a_coin_flip_matches_the_published_interval() -> None:
    # p = 0.5, n = 100, z = 1.96. The centre is exactly p because p + z²/2n = p(1 + z²/n)
    # when p = 0.5; half = z/(1 + z²/n) · sqrt(0.25/100 + z²/40000) = 0.0961671.
    ci = proportion(50.0, 100, 95)
    assert ci is not None
    assert (ci.low, ci.high) == (40.38, 59.62)
    assert (ci.n, ci.level, ci.method) == (100, 95, "wilson")


def test_wilson_does_not_collapse_where_nothing_happened() -> None:
    # The case Wald gets catastrophically wrong: it reports 0.0 ± 0.0 for every one of these.
    # Wilson: centre = (z²/2n)/(1 + z²/n), half equals the centre exactly when p = 0, so the
    # interval is [0, 2·centre].
    ten = proportion(0.0, 10, 95)
    three = proportion(0.0, 3, 95)
    assert ten is not None and three is not None
    assert (ten.low, ten.high) == (0.0, 27.75)
    # "Folded to a 4-bet 0% of the time" over 3 opportunities means: somewhere under 56%.
    assert (three.low, three.high) == (0.0, 56.15)


def test_wilson_is_asymmetric_at_the_ends_and_stays_inside_the_range() -> None:
    one = proportion(100.0, 1, 95)
    assert one is not None
    assert (one.low, one.high) == (20.65, 100.0)  # a single observation says almost nothing
    assert one.high - 100.0 <= 0.0 < 100.0 - one.low  # never above 100, and one-sided


def test_wilson_widens_with_the_level() -> None:
    ninety = proportion(50.0, 100, 90)
    ninety_nine = proportion(50.0, 100, 99)
    assert ninety is not None and ninety_nine is not None
    assert (ninety.low, ninety.high) == (41.88, 58.12)  # z = 1.6449
    assert (ninety_nine.low, ninety_nine.high) == (37.53, 62.47)  # z = 2.5758


def test_wilson_on_the_founders_own_vpip() -> None:
    # 19,802 hands at VPIP 22.9573% (the hero parity fingerprint). The interval is ±0.6 of a
    # point: at this sample size the number is real, which is the other half of E.2's claim.
    ci = proportion(22.9573, 19_802, 95)
    assert ci is not None
    assert (ci.low, ci.high) == (22.38, 23.55)


def test_the_mean_interval_is_the_standard_error_scaled_by_a_hundred() -> None:
    # bb/100 = 100 · mean(net_won_bb). With sd = 1.0 bb per hand over 10,000 hands the
    # standard error of the mean is 0.01 bb/hand = 1.0 bb/100, so the half-width is
    # 100 · 1.959964 · 1.0 / sqrt(10000) = 1.959964.
    ci = mean(-1.37, 1.0, 10_000, 95)
    assert ci is not None
    assert (ci.low, ci.high) == (-3.33, 0.59)  # -1.37 ∓ 1.959964
    assert (ci.n, ci.level, ci.method) == (10_000, 95, "normal")


def test_the_same_winrate_over_two_hundred_hands_is_not_the_same_claim() -> None:
    # The whole point of the step. Identical point estimate, identical per-hand spread; the
    # band is sqrt(10000/200) = sqrt(50) = 7.0711 times wider, and now straddles zero.
    small = mean(-1.37, 1.0, 200, 95)
    large = mean(-1.37, 1.0, 10_000, 95)
    assert small is not None and large is not None
    assert (small.low, small.high) == (-15.229, 12.489)  # -1.37 ∓ 13.859038
    assert small.low < 0.0 < small.high and large.high > 0.0
    widening = (small.high - small.low) / (large.high - large.low)
    assert math.isclose(widening, math.sqrt(50.0), rel_tol=1e-3)


def test_the_founders_own_winrate_is_a_losing_one_at_every_point_of_its_interval() -> None:
    # -1.37 bb/100 over 19,802 hands with a per-hand spread of 0.9 bb (a normal NL figure):
    # half = 100 · 1.959964 · 0.9 / sqrt(19802) = 1.253534.
    ci = mean(-1.37, 0.9, 19_802, 95)
    assert ci is not None
    assert (ci.low, ci.high) == (-2.624, -0.116)
    assert ci.high < 0.0


def test_a_mean_needs_thirty_observations_and_a_finite_spread() -> None:
    assert mean(-1.37, 1.0, 1, 95) is None  # stddevSamp of one row is nan
    assert mean(-1.37, math.nan, 500, 95) is None
    assert mean(math.nan, 1.0, 500, 95) is None
    assert mean(-1.37, -1.0, 500, 95) is None  # a negative standard deviation is a bug upstream


def test_a_mean_says_nothing_rather_than_something_six_times_too_confident() -> None:
    # `z` is the normal quantile; at small n the right one is Student's t, which is 12.706 at
    # n = 2 against z = 1.960 -- a band 6.5x too narrow. An interval that understates the
    # uncertainty by six times is the failure this step exists to prevent, so below MIN_N_MEAN
    # there is no interval at all (spec §17: below the threshold, say "insufficient data").
    assert MIN_N_MEAN == 30
    assert mean(-1.37, 1.0, 2, 95) is None
    assert mean(-1.37, 1.0, 29, 95) is None
    at_thirty = mean(-1.37, 1.0, 30, 95)
    assert at_thirty is not None
    # t(29) = 2.045 against z = 1.960: the band that is kept is ~4% narrow, and the module
    # docstring is explicit that every interval here is a floor on the uncertainty.
    assert math.isclose(
        at_thirty.high - (-1.37), 100 * 1.959963984540054 / math.sqrt(30), abs_tol=5e-4
    )


def test_a_proportion_needs_one_observation_and_a_finite_value() -> None:
    assert proportion(50.0, 0, 95) is None
    assert proportion(math.nan, 100, 95) is None


def test_only_proportions_and_per_hundred_means_get_an_interval() -> None:
    # `ratio` is the aggression factor: (bets + raises) / calls over two disjoint row sets,
    # unbounded above. Wilson is not defined for it and no interval is offered (ADR-040).
    assert for_cell("ratio", 2.4, 5_000, None, 95) is None
    assert for_cell("count", 19_802.0, 19_802, None, 95) is None
    assert for_cell("percent", None, 400, None, 95) is None
    # A per-100 stat whose query carried no spread column gets no guess at one.
    assert for_cell("per100", -1.37, 10_000, None, 95) is None


def test_for_cell_routes_each_format_to_its_own_estimator() -> None:
    percent = for_cell("percent", 50.0, 100, None, 95)
    per100 = for_cell("per100", -1.37, 10_000, 1.0, 95)
    assert percent is not None and per100 is not None
    assert percent.method == "wilson" and (percent.low, percent.high) == (40.38, 59.62)
    assert per100.method == "normal" and (per100.low, per100.high) == (-3.33, 0.59)
    assert percent.n == 100 and per100.n == 10_000  # n travels with every interval


def test_the_z_table_is_the_standard_normal_quantile() -> None:
    # z = sqrt(2) · erfinv(level/100) -- checked here through erf, which the stdlib has and
    # erfinv, which it does not: erf(z / sqrt(2)) must be the two-sided coverage.
    for level, z in Z.items():
        assert math.isclose(math.erf(z / math.sqrt(2.0)), level / 100.0, abs_tol=5e-13)
