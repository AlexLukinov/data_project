"""`/v1/pool/*`: the Pool area (plan §2.8, ADR-026) -- population stats, cohorts, players.

Thin: tenancy from the token, cohort rows from Postgres, and the work handed to
`analysis.pool` in the thread pool (the ClickHouse client is blocking). Every cohort row is
scoped by `user_id` in the WHERE clause: another tenant's cohort must 404, never 200.

The pool's *node* tiers -- `/v1/pool/node/*`, the three-tier read of one situation -- are
`api/routers/pool_nodes.py`, mounted under this module's own `PREFIX` and `TAG` so the split
is invisible from outside (ADR-065). They share this module's cohort helpers; it imports
nothing from them.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from analysis.pool import cohorts as cohort_service
from analysis.pool.service import PlayerMatches, PlayerSearch, pool_report, presets
from analysis.pool.service import players as player_lookup
from api import cache, hand_query
from api import hand_note_store as notes
from api.deps import CurrentUserDep, SessionDep
from api.models_pg import Cohort
from api.ratelimit import tenant_rate_limit
from api.routers.hands import TagFilter
from api.schemas import HandSummary
from api.schemas_pool import CohortDetailOut, CohortIn, CohortOut, PoolPresetsOut
from stats.errors import RegistryError, ReportError
from stats.request import CohortSpec, ReportRequest, ReportResult
from stats.service import Cache, validate_request

PREFIX = "/v1/pool"
TAG = "pool"
"""The Pool area's one prefix and tag, shared with `pool_nodes.py` so a URL cannot drift."""

router = APIRouter(prefix=PREFIX, tags=[TAG], dependencies=[Depends(tenant_rate_limit)])

Limit = Annotated[int, Query(ge=1, le=cohort_service.MAX_MEMBERS)]


def report_cache() -> Cache | None:
    """The cache the services should use. Unit tests replace this with `None`."""
    return cache


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


async def load_cohort(session: AsyncSession, user_id: uuid.UUID, cohort_id: uuid.UUID) -> Cohort:
    """The user's cohort by id, or 404 -- the same answer for missing and for someone else's."""
    result = await session.execute(
        select(Cohort).where(Cohort.id == cohort_id, Cohort.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


def cohort_spec(row: Cohort) -> CohortSpec:
    """The stored criteria as the engine's document."""
    return CohortSpec.model_validate(row.criteria)


def _checked_criteria(body: CohortIn) -> dict[str, Any]:
    """A cohort must compile: every rule on a cached stat the registry knows."""
    try:
        validate_request(cohort_service.members_request(body.criteria, limit=1))
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc
    return body.criteria.model_dump(mode="json")


async def _commit(session: AsyncSession, row: Cohort) -> None:
    try:
        session.add(row)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"a cohort named {row.name!r} already exists"
        ) from exc
    await session.refresh(row)


# ---- cohorts -----------------------------------------------------------------------------


@router.get("/cohorts", response_model=list[CohortOut])
async def list_cohorts(user: CurrentUserDep, session: SessionDep) -> Sequence[Cohort]:
    """The user's cohorts, oldest first."""
    result = await session.execute(
        select(Cohort).where(Cohort.user_id == user.id).order_by(Cohort.created_at)
    )
    return result.scalars().all()


@router.post("/cohorts", response_model=CohortOut, status_code=status.HTTP_201_CREATED)
async def create_cohort(body: CohortIn, user: CurrentUserDep, session: SessionDep) -> Cohort:
    """Save a cohort under a name unique to the user."""
    row = Cohort(user_id=user.id, name=body.name, criteria=_checked_criteria(body))
    await _commit(session, row)
    return row


@router.get("/cohorts/{cohort_id}", response_model=CohortDetailOut)
async def get_cohort(
    cohort_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> CohortDetailOut:
    """One cohort with its current size."""
    row = await load_cohort(session, user.id, cohort_id)
    players = await run_in_threadpool(cohort_service.size, cohort_spec(row), user.tenant_id)
    return CohortDetailOut(**CohortOut.model_validate(row).model_dump(), players=players)


@router.put("/cohorts/{cohort_id}", response_model=CohortOut)
async def update_cohort(
    cohort_id: uuid.UUID, body: CohortIn, user: CurrentUserDep, session: SessionDep
) -> Cohort:
    """Replace a cohort's name and criteria."""
    row = await load_cohort(session, user.id, cohort_id)
    row.name, row.criteria = body.name, _checked_criteria(body)
    await _commit(session, row)
    return row


@router.delete("/cohorts/{cohort_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cohort(cohort_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> None:
    """Delete a cohort."""
    await session.delete(await load_cohort(session, user.id, cohort_id))
    await session.commit()


@router.get("/cohorts/{cohort_id}/members", response_model=ReportResult)
async def cohort_members(
    cohort_id: uuid.UUID, user: CurrentUserDep, session: SessionDep, limit: Limit = 100
) -> ReportResult:
    """The cohort's players, one row each, with the headline stats they qualified on."""
    row = await load_cohort(session, user.id, cohort_id)
    return await run_in_threadpool(
        cohort_service.members, cohort_spec(row), user.tenant_id, limit=limit, cache=report_cache()
    )


# ---- reports -----------------------------------------------------------------------------


@router.post("/stats", response_model=ReportResult)
async def pool_stats(
    body: ReportRequest,
    user: CurrentUserDep,
    session: SessionDep,
    cohort_id: uuid.UUID | None = None,
) -> ReportResult:
    """A population report, optionally restricted to a saved cohort.

    Set `player_key` on the body for one opponent's report.
    """
    cohort = cohort_spec(await load_cohort(session, user.id, cohort_id)) if cohort_id else None
    try:
        return await run_in_threadpool(
            pool_report, body, user.tenant_id, cohort=cohort, cache=report_cache()
        )
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc


@router.post("/players", response_model=PlayerMatches)
def find_players(body: PlayerSearch, user: CurrentUserDep) -> PlayerMatches:
    """Pool players whose screen name contains `body.name`, the exact one first, then busiest.

    The name is part of a screen name, or a whole key pasted back (`<site>:<name>`); the match
    is on the name half either way, and too short a name is a 400 that says so. A POST like
    the other pool reads, so no access log ever holds a real screen name (ADR-062, ADR-058).
    """
    try:
        return player_lookup(body.name, user.tenant_id, limit=body.limit)
    except ReportError as exc:
        raise _bad_request(exc) from exc


@router.get("/hands", response_model=list[HandSummary])
async def pool_hands(
    user: CurrentUserDep,
    session: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
    stake_level: str | None = None,
    limit: Limit = 50,
    tag: TagFilter = None,
) -> list[HandSummary]:
    """Recent hands from the pool, newest first (plan F.7), each with the user's tags on it.

    A pool hand has no hero seat, so each row opens on the seat worth watching: one that
    showed cards if any did, else the biggest winner. For hands where a *situation* happened,
    `POST /v1/hands/search` with `dataset: population` is the query to use. `?tag=` narrows
    to the hands carrying that tag, the same way it does on `/v1/hands` (ADR-048).
    """
    only = None if tag is None else await notes.hands_tagged(session, user.id, tag)
    if only == []:
        return []
    refs = await run_in_threadpool(
        hand_query.pool_hand_refs,
        user.tenant_id,
        date_from=date_from,
        date_to=date_to,
        stake_level=stake_level,
        limit=limit,
        only=only,
    )
    rows = await run_in_threadpool(hand_query.summaries_for, user.tenant_id, refs)
    return await notes.attach_tags(session, user.id, rows)


@router.get("/presets", response_model=PoolPresetsOut)
def pool_presets(user: CurrentUserDep) -> PoolPresetsOut:
    """The pool area's landing reports and ready-made cohorts."""
    return PoolPresetsOut(reports=presets(), cohorts=cohort_service.cohort_presets())
