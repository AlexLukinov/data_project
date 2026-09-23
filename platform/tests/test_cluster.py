"""Cluster-robust intervals: every formula against a value worked by hand (ADR-076, G.3).

The same rule as `test_intervals.py`: the expected values below were derived from the ratio
estimator's formulas with the arithmetic in a trailing comment, not by running the module and
pasting what it said. The design effect on the real pool is `tests/test_cluster_real.py`'s
business; here the players are invented and small enough to add up on paper.
"""

from __future__ import annotations

import math

import pytest

from stats.cluster import (
    MIN_PLAYERS,
    ClusterSums,
    for_cell,
    mean_by_player,
    needed,
    proportion_by_player,
    wilson_arm,
)
from stats.interval import Z, proportion, wilson


def identical(players: int, rows: int, taken: int) -> ClusterSums:
    """`players` players, each with `rows` rows of which `taken` did the thing."""
    return ClusterSums(
        players=players,
        n=players * rows,
        x=players * taken,
        squares=players * taken * taken,
        cross=players * taken * rows,
        sizes=players * rows * rows,
    )


def test_two_players_who_disagree_completely_have_a_huge_design_effect() -> None:
    # (n, x) = (10, 9) and (10, 1): p = 0.5, S = (9 - 5)² + (1 - 5)² = 32,
    # Var_c = 2/1 · 32 / 400 = 0.16, Var_b = 0.25 / 20 = 0.0125, DEFF = 12.8.
    sums = ClusterSums(players=2, n=20, x=10, squares=82, cross=100, sizes=200)
    assert sums.ratio == 0.5
    assert math.isclose(sums.variance() or 0.0, 0.16)
    assert math.isclose(sums.binomial_variance() or 0.0, 0.0125)
    assert math.isclose(sums.design_effect() or 0.0, 12.8)
    effective, effect = sums.effective()
    assert math.isclose(effective, 20 / 12.8) and effect is not None


def test_identical_players_have_no_between_player_spread_and_a_design_effect_of_one() -> None:
    # Every player 15 of 25: Σ(x_i - p·n_i)² = 0 exactly, so the clustered interval IS the
    # binomial Wilson on the 1,000 rows -- an independent sample pays nothing.
    sums = identical(40, 25, 15)
    assert sums.variance() == 0.0 and sums.design_effect() == 1.0
    clustered = proportion_by_player(sums, 95)
    plain = proportion(60.0, 1000, 95)
    assert clustered is not None and plain is not None
    assert (clustered.low, clustered.high) == (plain.low, plain.high)
    assert clustered.method == "cluster" and clustered.players == 40
    assert clustered.effective_n == 1000.0 and clustered.design_effect == 1.0


def test_the_design_effect_is_never_reported_below_one() -> None:
    # Players *more* alike than chance would make them: Var_c < Var_b happens by sampling
    # noise, and a design effect under 1 would let a clustered interval be narrower than the
    # binomial one. (10, 5) x 30 players plus one (10, 6) and one (10, 4): S = 1 + 1 = 2 over
    # N = 320, p = 0.5: Var_c = 32/31 · 2 / 102400 ≈ 2.0e-5, Var_b = 0.25/320 ≈ 7.8e-4.
    sums = ClusterSums(players=32, n=320, x=160, squares=30 * 25 + 36 + 16, cross=1600, sizes=3200)
    assert sums.design_effect() == 1.0


def test_no_variation_assumes_the_worst_case_and_reports_no_effect() -> None:
    # p = 1 with unequal players: one with 71 rows, 29 with one each. N = 100, Σn_i² = 5,070,
    # Kish's effective clusters = 100² / 5,070 = 1.97: the whale is most of the sample.
    sums = ClusterSums(players=30, n=100, x=100, squares=5070, cross=5070, sizes=5070)
    assert sums.design_effect() is None
    effective, effect = sums.effective()
    assert math.isclose(effective, 10000 / 5070) and effect is None
    span = proportion_by_player(sums, 95)
    assert span is not None
    assert span.design_effect is None and span.effective_n == 2.0
    # Wilson at p = 1 on two observations says "somewhere above a third", not "100% ± 0".
    assert span.high == 100.0 and 30.0 < span.low < 40.0


def test_a_numerator_past_its_denominator_is_clipped_not_a_domain_error() -> None:
    """A custom stat's numerator need not be a subset of its denominator; the flat path clips."""
    sums = ClusterSums(
        players=40, n=1000, x=1500, squares=40 * 1406.25, cross=40 * 937.5, sizes=40 * 625
    )
    span = proportion_by_player(sums, 95)
    assert span is not None and span.high == 100.0 and span.low > 90.0


def test_a_single_player_cannot_yield_a_variance() -> None:
    sums = ClusterSums(players=1, n=300, x=150, squares=22500, cross=45000, sizes=90000)
    assert sums.variance() is None and sums.design_effect() is None
    assert proportion_by_player(sums, 95) is None  # under MIN_PLAYERS anyway


def test_under_thirty_players_there_is_no_interval_for_a_proportion_or_a_mean() -> None:
    thin = identical(MIN_PLAYERS - 1, 40, 20)
    assert proportion_by_player(thin, 95) is None
    assert mean_by_player(-1.37, thin, 95) is None
    enough = identical(MIN_PLAYERS, 40, 20)
    assert proportion_by_player(enough, 95) is not None


def test_the_mean_interval_is_the_cluster_robust_standard_error_times_a_hundred() -> None:
    # 30 players, 100 rows each, each player's total t_i = 100 · m_i with m_i = 0.02 ± 0.01
    # alternating (15 of each): m = 0.02, Σ(t_i - m·n_i)² = 30 · 1² = 30,
    # Var_c = 30/29 · 30 / 3000² = 3.448e-6, SE = 1.857e-3 bb/hand = 0.1857 bb/100,
    # half = 1.959964 · 0.1857 = 0.364.
    sums = ClusterSums(
        players=30, n=3000, x=60.0, squares=15 * 9 + 15 * 1, cross=6000.0, sizes=300000
    )
    span = mean_by_player(2.0, sums, 95)
    assert span is not None
    assert (span.low, span.high) == (1.636, 2.364)
    assert span.method == "cluster" and span.players == 30 and span.design_effect is None


def test_the_wider_arm_is_the_band_a_sentence_must_carry() -> None:
    z = Z[95]
    # Symmetric at a coin flip.
    _, half = wilson(0.5, 100, z)
    assert math.isclose(wilson_arm(0.5, 100, z), half)
    # At p = 1 the interval is [low, 1]: the arm is the whole lower side, twice Wilson's own
    # half-width there -- z² / (n + z²) = 0.037 on 100 rows, against a half of 0.0185.
    centre_at_one, half_at_one = wilson(1.0, 100, z)
    assert math.isclose(wilson_arm(1.0, 100, z), 1.0 - (centre_at_one - half_at_one))
    assert math.isclose(wilson_arm(1.0, 100, z), 2 * half_at_one)
    assert math.isclose(wilson_arm(1.0, 100, z), z * z / (100 + z * z))


def test_needed_is_the_smallest_sample_within_the_bar_and_scales_with_the_effect() -> None:
    z = Z[95]
    at_one = needed(0.5, 1.0, 0.05, 95)
    assert wilson_arm(0.5, at_one, z) <= 0.05 < wilson_arm(0.5, at_one - 1, z)
    assert at_one == 381  # Wald says 384.1; Wilson's z²/4n² term buys three rows
    # ADR-076: at the pool's design effect a ±5 claim near 50% "wants n ≈ 1,800".
    assert 1_740 <= needed(0.5, 4.586, 0.05, 95) <= 1_760
    # Everyone folding: the arm is the lower side, and 73 effective observations bound it.
    assert needed(1.0, 1.0, 0.05, 95) == 73
    # A rare action is cheaper to pin in absolute terms than a coin flip -- though not as cheap
    # as the symmetric formula says, because its upper arm is the long one.
    assert needed(0.02, 1.0, 0.05, 95) == 101 < at_one


@pytest.mark.parametrize("fmt", ["ratio", "count"])
def test_only_proportions_and_means_get_a_clustered_interval(fmt: str) -> None:
    record = {
        "x": 2.4,
        "x__n": 500,
        "x__x": 1200,
        "x__k": 40,
        "x__xx": 1.0,
        "x__xn": 1.0,
        "x__nn": 1.0,
    }
    assert for_cell(fmt, 2.4, "x", record, 95) is None  # type: ignore[arg-type]


def test_a_row_without_the_cluster_columns_gets_no_guess_at_an_interval() -> None:
    assert for_cell("percent", 60.0, "x", {"x": 60.0, "x__n": 1000}, 95) is None
    assert ClusterSums.from_record("x", {"x__n": 1000, "x__x": 600}) is None


def test_for_cell_reads_the_sums_off_the_record() -> None:
    record = {
        "fold": 60.0,
        "fold__n": 1000,
        "fold__x": 600,
        "fold__k": 40,
        "fold__xx": 40 * 225,
        "fold__xn": 40 * 375,
        "fold__nn": 40 * 625,
    }
    span = for_cell("percent", 60.0, "fold", record, 95)
    plain = proportion(60.0, 1000, 95)
    assert span is not None and plain is not None
    assert (span.low, span.high, span.n, span.players) == (plain.low, plain.high, 1000, 40)
