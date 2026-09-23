"""The seven cohorts of ADR-077 and the five groups of ADR-080 (plan G.4).

The claim the file exists for: **every pool player falls in exactly one of the seven**. The
rules are axis-aligned thresholds on VPIP and hands, so the plane is cut into cells by the
thresholds the rules name; a check at every threshold, just under it, just over it and far
past it, on both axes, visits every cell and every edge, and is a proof for rules of this
shape -- and it grows with the rules, because the grid is built from them.
"""

from __future__ import annotations

import operator
import re
from collections.abc import Callable
from itertools import product

import pytest

from analysis.pool import cohorts
from analysis.pool.cohorts import GROUP_LABELS, CohortPreset
from stats.errors import ReportError
from stats.query import build_query
from stats.registry import registry
from stats.request import CohortSpec, CohortUnion, ReportRequest
from stats.resolve import dimensions_used, resolve_stats
from stats.router import plan

OPS: dict[str, Callable[[float, float], bool]] = {
    "lt": operator.lt,
    "lte": operator.le,
    "gt": operator.gt,
    "gte": operator.ge,
}
EPSILON = 1e-6
FAR = 1e9

MEASURED: dict[str, str] = {
    "reg": "45.4%",
    "reg_m": "42.6%",
    "mid": "41.7%",
    "fish": "38.8%",
    "reg_s": "41.5%",
    "mid_s": "40.0%",
    "fish_s": "39.9%",
}
"""ADR-077's table: fold to a flop c-bet, BB defending a single-raised pot heads-up."""


@pytest.fixture(scope="module")
def presets() -> list[CohortPreset]:
    return cohorts.cohort_presets()


def holds(spec: CohortSpec, vpip: float, hands: float) -> bool:
    values = {"vpip": vpip, "hands": hands}
    return all(OPS[rule.op](values[rule.stat], rule.value) for rule in spec.rules)


def grid(presets: list[CohortPreset], stat: str) -> list[float]:
    """Every threshold a rule names on `stat`, each visited at, just under and just over it."""
    thresholds = sorted({rule.value for p in presets for rule in p.rules if rule.stat == stat})
    return [0.0, FAR, *(t + d for t in thresholds for d in (-EPSILON, 0.0, EPSILON))]


def test_the_seven_cover_every_player_exactly_once(presets: list[CohortPreset]) -> None:
    assert len(presets) == 7
    assert {rule.stat for p in presets for rule in p.rules} == {"vpip", "hands"}
    for vpip, hands in product(grid(presets, "vpip"), grid(presets, "hands")):
        named = [p.code for p in presets if holds(p.spec, vpip, hands)]
        assert len(named) == 1, f"VPIP {vpip}, hands {hands}: {named or 'nobody'}"


def test_each_description_carries_its_measured_fold_rate_with_sample_and_date(
    presets: list[CohortPreset],
) -> None:
    for preset in presets:
        assert MEASURED[preset.code] in preset.description, preset.code
        assert "2026-09-22" in preset.description, preset.code
        assert re.search(r"over [\d,]+ decisions", preset.description), preset.code


def test_every_label_belongs_to_exactly_one_of_the_five_groups(presets: list[CohortPreset]) -> None:
    groups = cohorts.groups(presets)
    assert (
        [g.key for g in groups] == list(GROUP_LABELS) == ["all", "reg", "other", "fish", "unknown"]
    )
    by_key = {g.key: g for g in groups}
    assert by_key["all"].cohorts == [p.code for p in presets]
    for preset in presets:
        homes = [g.key for g in groups if g.key != "all" and preset.code in g.cohorts]
        assert homes == [preset.group], preset.code
    # ADR-080's table, to the letter: reg_m plays like the mid-VPIP label, and the three thin
    # labels are indistinguishable.
    assert by_key["reg"].cohorts == ["reg"] and by_key["fish"].cohorts == ["fish"]
    assert by_key["other"].cohorts == ["reg_m", "mid"]
    assert by_key["unknown"].cohorts == ["reg_s", "mid_s", "fish_s"]


def test_a_group_is_one_presets_rules_or_their_union(presets: list[CohortPreset]) -> None:
    assert cohorts.group_spec("all", presets) is None
    assert cohorts.group_spec("reg", presets) == cohorts.preset_spec("reg", presets)
    other = cohorts.group_spec("other", presets)
    assert isinstance(other, CohortUnion) and len(other.any) == 2
    unknown = cohorts.group_spec("unknown", presets)
    assert isinstance(unknown, CohortUnion) and len(unknown.any) == 3


def test_a_key_names_a_preset_or_a_group_and_nothing_else(presets: list[CohortPreset]) -> None:
    assert cohorts.cohort_by_key("", presets) is None
    assert cohorts.cohort_by_key("preset:fish", presets) == cohorts.preset_spec("fish", presets)
    assert isinstance(cohorts.cohort_by_key("group:unknown", presets), CohortUnion)
    assert cohorts.cohort_by_key("group:all", presets) is None
    with pytest.raises(ReportError, match="preset:<code> nor group:<key>"):
        cohorts.cohort_by_key("regs", presets)
    with pytest.raises(ReportError, match="the presets are: reg, reg_m, mid"):
        cohorts.cohort_by_key("preset:regs", presets)
    with pytest.raises(ReportError, match="the groups are: all, reg, other"):
        cohorts.cohort_by_key("group:whales", presets)


def test_a_preset_declaring_an_unknown_group_fails_at_load(
    tmp_path: pytest.TempPathFactory,
) -> None:
    path = tmp_path / "presets.yaml"  # type: ignore[operator]
    path.write_text(
        "cohorts:\n  - code: x\n    label: X\n    group: whales\n"
        "    rules:\n      - {stat: vpip, op: lt, value: 25}\n"
    )
    with pytest.raises(Exception, match=r"cohorts\[0\]: group 'whales' is not one of"):
        cohorts.cohort_presets(path)


def test_a_duplicated_cohort_code_fails_at_load(tmp_path: pytest.TempPathFactory) -> None:
    path = tmp_path / "presets.yaml"  # type: ignore[operator]
    one = (
        "  - code: x\n    label: X\n    group: reg\n    rules:\n"
        "      - {stat: vpip, op: lt, value: 25}\n"
    )
    path.write_text("cohorts:\n" + one + one)
    with pytest.raises(Exception, match="duplicate cohort 'x'"):
        cohorts.cohort_presets(path)


def test_the_union_compiles_to_one_rollup_scan(presets: list[CohortPreset]) -> None:
    request = ReportRequest(
        dataset="population",
        hero_only=False,
        stats=["vpip"],
        cohort=cohorts.group_spec("other", presets),
    )
    reg = registry()
    stats = resolve_stats(request, reg)
    ((sql, params),) = [
        build_query(request, 1, p, reg) for p in plan(stats, dimensions_used(request), reg)
    ]
    assert sql.count("SELECT c.player_key FROM") == 1
    assert ") OR (" in sql
    # reg_m's three thresholds, then mid's three, every one bound.
    assert [params[f"p{i}"] for i in range(6)] == [25, 200, 1000, 25, 35, 200]
