"""Cohorts (plan §2.8, F-602): sets of pool players named by stat criteria.

A cohort is a `CohortSpec` -- rules like `vpip < 25 and hands >= 1000` -- that the engine
evaluates per player at query time; nothing here stores members. This module answers what a
cohort is made of (its size, its members with headline stats) and ships the two presets every
poker player names first: regs and recreational players.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field

from analysis.pool.service import PLAYER_STATS, PRESETS
from analysis.presets import read_yaml
from stats.ast import CODE, _Strict
from stats.cohort import cohort_size
from stats.errors import RegistryError
from stats.registry import Registry, registry
from stats.request import DATASET_POPULATION, CohortRule, CohortSpec, ReportRequest, ReportResult
from stats.service import Cache, Runner, run_report, validate_request

MAX_MEMBERS = 1000


class CohortPreset(_Strict):
    """A named cohort a user can adopt as-is."""

    code: str = Field(pattern=CODE)
    label: str = Field(min_length=1)
    description: str = ""
    rules: list[CohortRule] = Field(min_length=1)

    @property
    def spec(self) -> CohortSpec:
        """The rules as the engine's cohort document."""
        return CohortSpec(rules=self.rules)


def cohort_presets(path: Path = PRESETS, reg: Registry | None = None) -> list[CohortPreset]:
    """The `cohorts` of the presets file, each validated as a population report."""
    reg = reg or registry()
    presets: list[CohortPreset] = []
    for i, entry in enumerate(read_yaml(path).get("cohorts") or []):
        try:
            preset = CohortPreset.model_validate(entry)
            validate_request(members_request(preset.spec, limit=1), reg)
        except (ValueError, RegistryError) as exc:
            raise RegistryError(f"{path.name} cohorts[{i}]: {exc}") from exc
        presets.append(preset)
    return presets


def members_request(spec: CohortSpec, *, limit: int = MAX_MEMBERS) -> ReportRequest:
    """One row per member with the headline stats: the pool grouped by player, in the cohort."""
    return ReportRequest(
        dataset=DATASET_POPULATION,
        hero_only=False,
        stats=list(PLAYER_STATS),
        group_by=["player_key"],
        cohort=spec,
        limit=min(limit, MAX_MEMBERS),
    )


def members(
    spec: CohortSpec,
    tenant_id: int,
    *,
    limit: int = MAX_MEMBERS,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> ReportResult:
    """The cohort's players, each with the headline stats they qualified on."""
    return run_report(members_request(spec, limit=limit), tenant_id, run=run, cache=cache, reg=reg)


def size(
    spec: CohortSpec, tenant_id: int, *, run: Runner | None = None, reg: Registry | None = None
) -> int:
    """How many players the cohort names."""
    return cohort_size(spec, tenant_id, run=run, reg=reg)
