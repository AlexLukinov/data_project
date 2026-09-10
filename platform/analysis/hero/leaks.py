"""Leaks v1 (plan §2.8, C.7): where the hero's frequencies stray furthest from the baseline.

For every stat in the `leaks` preset, the hero's value and the baseline's are compared and the
gap scored `|delta| * sqrt(n)`: a large deviation over many opportunities outranks a larger one
over few. Stats under `min_n` opportunities are set aside rather than ranked -- a 3-bet
frequency over 40 chances is noise, not a leak. The baseline is whatever the `BaselineProvider`
answers: the whole pool, a cohort of it ("regs") when asked, a solver later (ADR-011).
"""

from __future__ import annotations

import math
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field

from analysis.pool.baselines import BaselineProvider
from analysis.presets import Preset, load_presets, read_yaml
from stats.ast import _Strict
from stats.errors import RegistryError
from stats.registry import Registry, registry
from stats.request import DATASET_HERO, MAX_STATS, Cell, CohortSpec, ReportRequest, ReportResult
from stats.service import Cache, Runner, run_report

PRESETS = Path(__file__).with_name("presets.yaml")


class LeakPreset(_Strict):
    """Which stats the leak finder ranks, and the opportunity floor."""

    min_n: int = Field(ge=1)
    stats: list[str] = Field(min_length=1)


class Leak(_Strict):
    """One stat where the hero deviates from the baseline, with everything needed to judge it."""

    code: str
    label: str
    category: str
    value: float
    n: int
    baseline: float
    baseline_n: int
    delta: float
    score: float
    direction: Literal["above", "below"]
    typical: tuple[float, float] | None = None
    higher_is_better: bool | None = None


class LeaksResult(_Strict):
    """Leaks ranked by score; `skipped` names the stats under the opportunity floor."""

    hands: int
    min_n: int
    leaks: list[Leak]
    skipped: list[str]


@lru_cache(maxsize=1)
def leak_preset(path: Path = PRESETS) -> LeakPreset:
    """The `leaks` section of the presets file; every stat must be a cached registry stat."""
    try:
        preset = LeakPreset.model_validate(read_yaml(path).get("leaks"))
    except ValueError as exc:
        raise RegistryError(f"{path.name} leaks: {exc}") from exc
    reg = registry()
    for code in preset.stats:
        if not reg.stat(code).cached:
            raise RegistryError(f"{path.name} leaks: {code!r} is not cached (rollup stats only)")
    return preset


def presets(reg: Registry | None = None) -> list[Preset]:
    """The hero's report presets, validated against the registry."""
    return load_presets(PRESETS, DATASET_HERO, reg)


def find_leaks(
    tenant_id: int,
    *,
    provider: BaselineProvider,
    date_from: date | None = None,
    date_to: date | None = None,
    cohort: CohortSpec | None = None,
    min_n: int | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> LeaksResult:
    """The hero's leaks against the provider's baseline, best-scored first."""
    reg = reg or registry()
    preset = leak_preset()
    floor = preset.min_n if min_n is None else min_n
    leaks: list[Leak] = []
    skipped: list[str] = []
    hands = 0
    for start in range(0, len(preset.stats), MAX_STATS):
        request = ReportRequest(
            dataset=DATASET_HERO,
            hero_only=True,
            date_from=date_from,
            date_to=date_to,
            stats=preset.stats[start : start + MAX_STATS],
        )
        mine = run_report(request, tenant_id, run=run, cache=cache, reg=reg)
        pool = provider.baseline(request, tenant_id, cohort)
        hands = max(hands, mine.hands)
        for code in request.stats:
            leak = _leak(code, _cell(mine, code), _cell(pool, code), floor, reg)
            if leak is None:
                skipped.append(code)
            else:
                leaks.append(leak)
    leaks.sort(key=lambda leak: leak.score, reverse=True)
    return LeaksResult(hands=hands, min_n=floor, leaks=leaks, skipped=skipped)


def _cell(result: ReportResult, code: str) -> Cell | None:
    return result.rows[0].cells.get(code) if result.rows else None


def _leak(
    code: str, mine: Cell | None, pool: Cell | None, floor: int, reg: Registry
) -> Leak | None:
    """The scored gap, or None when either side is missing or the hero's sample is too small."""
    if mine is None or mine.value is None or mine.n < floor:
        return None
    if pool is None or pool.value is None:
        return None
    stat = reg.stat(code)
    delta = round(mine.value - pool.value, 3)
    return Leak(
        code=code,
        label=stat.label,
        category=stat.category,
        value=mine.value,
        n=mine.n,
        baseline=pool.value,
        baseline_n=pool.n,
        delta=delta,
        score=round(abs(delta) * math.sqrt(mine.n), 2),
        direction="above" if delta >= 0 else "below",
        typical=stat.typical,
        higher_is_better=stat.higher_is_better,
    )
