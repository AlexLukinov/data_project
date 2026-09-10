"""Pool reports and player lookup (plan §2.8): population stats by situation, per opponent."""

from __future__ import annotations

from pathlib import Path

from analysis.presets import Preset, load_presets
from stats.ast import Leaf
from stats.errors import ReportError
from stats.registry import Registry
from stats.request import DATASET_POPULATION, CohortSpec, ReportRequest, ReportResult
from stats.service import Cache, Runner, run_report

PRESETS = Path(__file__).with_name("presets.yaml")
PLAYER_STATS = ("hands", "vpip", "pfr", "threebet", "bb_per_100")
"""What a player lookup shows beside each screen name: enough to tell a reg from a fish."""
MAX_PLAYERS = 200


def pool_report(
    request: ReportRequest,
    tenant_id: int,
    *,
    cohort: CohortSpec | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> ReportResult:
    """A report on the population, optionally restricted to a cohort.

    A per-opponent report is the same call with `player_key` set on the request: the engine
    scopes it, and the cohort (if any) still applies, so "this player, if a reg" is expressible.
    """
    if request.dataset != DATASET_POPULATION:
        raise ReportError("pool reports read the population dataset")
    scoped = request if cohort is None else request.model_copy(update={"cohort": cohort})
    return run_report(scoped, tenant_id, run=run, cache=cache, reg=reg)


def players(
    prefix: str,
    tenant_id: int,
    *,
    limit: int = 50,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> ReportResult:
    """Pool players whose screen name starts with `prefix`, one row each, with headline stats."""
    request = ReportRequest(
        dataset=DATASET_POPULATION,
        hero_only=False,
        stats=list(PLAYER_STATS),
        group_by=["player_key"],
        filter=Leaf(dim="player_key", op="prefix", value=prefix),
        limit=min(limit, MAX_PLAYERS),
    )
    return run_report(request, tenant_id, run=run, cache=cache, reg=reg)


def presets(reg: Registry | None = None) -> list[Preset]:
    """The pool's report presets, validated against the registry."""
    return load_presets(PRESETS, DATASET_POPULATION, reg)
