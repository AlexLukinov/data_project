"""Presets load, validate against the registry, and fail loudly naming the entry."""

from __future__ import annotations

from pathlib import Path

import pytest

from analysis.hero import leaks as hero
from analysis.pool import cohorts
from analysis.pool import service as pool
from analysis.presets import load_presets
from stats.errors import RegistryError


def test_hero_presets_are_hero_reports() -> None:
    presets = hero.presets()
    codes = [p.code for p in presets]
    assert len(codes) == len(set(codes)) and "preflop_overview" in codes
    for preset in presets:
        assert preset.request.dataset == "hero" and preset.request.hero_only


def test_pool_presets_are_population_reports_and_regs_carries_a_cohort() -> None:
    presets = pool.presets()
    by_code = {p.code: p for p in presets}
    for preset in presets:
        assert preset.request.dataset == "population" and not preset.request.hero_only
    regs = by_code["regs_by_position"].request.cohort
    assert regs is not None and [r.stat for r in regs.rules] == ["vpip", "hands"]


def test_cohort_presets_name_the_seven_labels_of_adr_077() -> None:
    codes = [c.code for c in cohorts.cohort_presets()]
    assert codes == ["reg", "reg_m", "mid", "fish", "reg_s", "mid_s", "fish_s"]
    regs = cohorts.cohort_presets()[0].spec
    assert regs.rules[0].op == "lt" and regs.rules[0].value == 25


def test_leak_preset_lists_cached_stats_only() -> None:
    preset = hero.leak_preset()
    assert preset.min_n == 100 and "vpip" in preset.stats and "af_flop" not in preset.stats


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (
            "reports:\n  - code: x\n    label: X\n    request: {stats: [nope]}\n",
            "'x': unknown stat",
        ),
        (
            "reports:\n  - code: x\n    label: X\n"
            "    request: {dataset: population, hero_only: false, stats: [vpip]}\n",
            "dataset must be 'hero'",
        ),
        (
            "reports:\n  - code: x\n    label: X\n    request: {stats: [vpip]}\n"
            "  - code: x\n    label: Y\n    request: {stats: [pfr]}\n",
            "duplicate preset 'x'",
        ),
        ("reports:\n  - code: x\n    request: {stats: [vpip]}\n", r"reports\[0\]"),
        ("- not a mapping\n", "expected a mapping"),
    ],
)
def test_broken_presets_are_rejected_naming_the_entry(
    tmp_path: Path, text: str, message: str
) -> None:
    path = tmp_path / "presets.yaml"
    path.write_text(text)
    with pytest.raises(RegistryError, match=message):
        load_presets(path, "hero")
