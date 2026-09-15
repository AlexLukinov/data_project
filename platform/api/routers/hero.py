"""`/v1/hero/*`: the My game area (plan §2.8, ADR-026) -- leaks, sessions, winnings, presets.

Thin: tenancy from the token, the baseline through the `BaselineProvider` seam, and the work
handed to `analysis.hero` in the thread pool (the ClickHouse client is blocking).
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

from analysis.hero.leaks import LeaksResult, find_leaks, presets
from analysis.hero.sessions import DEFAULT_GAP_MINUTES, SessionsResult, sessions
from analysis.hero.winnings import WinningsResult, winnings
from analysis.pool.baselines import BaselineProvider, PopulationBaseline
from analysis.presets import Preset
from api import cache
from api.deps import CurrentUserDep, SessionDep
from api.ratelimit import tenant_rate_limit
from api.routers.pool import cohort_spec, load_cohort
from stats.errors import RegistryError, ReportError
from stats.service import Cache

router = APIRouter(prefix="/v1/hero", tags=["hero"], dependencies=[Depends(tenant_rate_limit)])

MAX_GAP_MINUTES = 24 * 60
MinN = Annotated[int | None, Query(ge=1)]
GapMinutes = Annotated[int, Query(ge=1, le=MAX_GAP_MINUTES)]


def report_cache() -> Cache | None:
    """The cache the services should use. Unit tests replace this with `None`."""
    return cache


def baseline_provider() -> BaselineProvider:
    """What the hero is compared against: the pool. Unit tests swap in a fake."""
    return PopulationBaseline(cache=report_cache())


@router.get("/leaks", response_model=LeaksResult)
async def leaks(
    user: CurrentUserDep,
    session: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
    min_n: MinN = None,
    cohort_id: uuid.UUID | None = None,
) -> LeaksResult:
    """The hero's leaks against the pool, or against a saved cohort of it, best-scored first."""
    cohort = cohort_spec(await load_cohort(session, user.id, cohort_id)) if cohort_id else None
    try:
        return await run_in_threadpool(
            find_leaks,
            user.tenant_id,
            provider=baseline_provider(),
            date_from=date_from,
            date_to=date_to,
            cohort=cohort,
            min_n=min_n,
            cache=report_cache(),
        )
    except (ReportError, RegistryError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/sessions", response_model=SessionsResult)
def hero_sessions(
    user: CurrentUserDep,
    gap_minutes: GapMinutes = DEFAULT_GAP_MINUTES,
    date_from: date | None = None,
    date_to: date | None = None,
) -> SessionsResult:
    """The hero's sessions, split where play paused for longer than `gap_minutes`."""
    try:
        return sessions(
            user.tenant_id, gap_minutes=gap_minutes, date_from=date_from, date_to=date_to
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/winnings", response_model=WinningsResult)
def hero_winnings(
    user: CurrentUserDep, date_from: date | None = None, date_to: date | None = None
) -> WinningsResult:
    """The hero's winnings by day as running totals: actual, all-in EV, showdown, non-showdown.

    Cached under the tenant's `stats:` namespace, which the parser worker drops when an upload
    lands (ADR-047), so the curve is as fresh as the last upload rather than the cache TTL.
    """
    store = report_cache()
    key = cache.stats_key(
        user.tenant_id, "hero_winnings", {"date_from": date_from, "date_to": date_to}
    )
    hit = store.get_json(key) if store is not None else None
    if hit is not None:
        return WinningsResult.model_validate(hit)
    try:
        result = winnings(user.tenant_id, date_from=date_from, date_to=date_to)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if store is not None:
        store.set_json(key, result.model_dump(mode="json"))
    return result


@router.get("/presets", response_model=list[Preset])
def hero_presets(user: CurrentUserDep) -> list[Preset]:
    """The My game area's landing reports."""
    return presets()
