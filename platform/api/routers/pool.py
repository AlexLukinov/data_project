"""`/v1/pool/*`: the Pool area (plan §2.8, ADR-026) -- population stats, cohorts, players.

Thin: tenancy from the token, cohort rows from Postgres, and the work handed to
`analysis.pool` in the thread pool (the ClickHouse client is blocking). Every cohort row is
scoped by `user_id` in the WHERE clause: another tenant's cohort must 404, never 200.
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
from analysis.pool.node_service import NodeFrequencies, NodeShowdownRange
from analysis.pool.node_service import frequencies as node_frequencies
from analysis.pool.node_service import showdown_range as node_showdown_range
from analysis.pool.nodes import NodeKey
from analysis.pool.realization import NodeRealization
from analysis.pool.realization import realization as node_realization
from analysis.pool.reconstruct import NodeEstimatedRange
from analysis.pool.reconstruct import estimated_range as node_estimate
from analysis.pool.service import players as player_lookup
from analysis.pool.service import pool_report, presets
from api import cache, hand_query
from api.deps import CurrentUserDep, SessionDep
from api.models_pg import Cohort
from api.ratelimit import tenant_rate_limit
from api.schemas import HandSummary
from api.schemas_pool import CohortDetailOut, CohortIn, CohortOut, EstimateIn, PoolPresetsOut
from stats.errors import RegistryError, ReportError
from stats.request import CohortSpec, ReportRequest, ReportResult
from stats.service import Cache, validate_request

router = APIRouter(prefix="/v1/pool", tags=["pool"], dependencies=[Depends(tenant_rate_limit)])

Prefix = Annotated[str, Query(min_length=1, max_length=64)]
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


@router.get("/players", response_model=ReportResult)
def find_players(user: CurrentUserDep, prefix: Prefix, limit: Limit = 50) -> ReportResult:
    """Pool players whose screen name starts with `prefix`, with headline stats."""
    return player_lookup(prefix, user.tenant_id, limit=limit, cache=report_cache())


@router.post("/node/frequencies", response_model=NodeFrequencies)
async def node_frequencies_at(
    body: NodeKey, user: CurrentUserDep, session: SessionDep, cohort_id: uuid.UUID | None = None
) -> NodeFrequencies:
    """Tier 1: what the field does at this situation (spec §10.2).

    The key's last step is not part of the question — it is one of the answers. Under `min_n`
    observations the answer carries the count and nothing else: no number here may be invented.
    """
    cohort = cohort_spec(await load_cohort(session, user.id, cohort_id)) if cohort_id else None
    try:
        return await run_in_threadpool(
            node_frequencies, body, user.tenant_id, cohort=cohort, cache=report_cache()
        )
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc


@router.post("/node/showdown-range", response_model=NodeShowdownRange)
async def node_showdown_range_at(
    body: NodeKey, user: CurrentUserDep, session: SessionDep, cohort_id: uuid.UUID | None = None
) -> NodeShowdownRange:
    """Tier 2: the hands the field turned over at this situation (spec §10.3).

    `covers` says what share of the node's decisions were ever revealed, so the caller can
    show the range for what it is: the hands shown here, not the hands played here.
    """
    cohort = cohort_spec(await load_cohort(session, user.id, cohort_id)) if cohort_id else None
    try:
        return await run_in_threadpool(
            node_showdown_range, body, user.tenant_id, cohort=cohort, cache=report_cache()
        )
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc


@router.post("/node/estimated-range", response_model=NodeEstimatedRange)
async def node_estimated_range_at(
    body: EstimateIn, user: CurrentUserDep, session: SessionDep, cohort_id: uuid.UUID | None = None
) -> NodeEstimatedRange:
    """Tier 3: the prior reweighted by what the field does with each class (spec §10.3).

    The key's last step is the action being explained. `implied_frequency` against
    `observed_frequency` is the reconstruction checking its own work: they agree only if the
    per-class rates really do produce the frequency tier 1 measured directly.
    """
    cohort = cohort_spec(await load_cohort(session, user.id, cohort_id)) if cohort_id else None
    try:
        return await run_in_threadpool(
            node_estimate,
            body.node,
            body.prior,
            user.tenant_id,
            cohort=cohort,
            cache=report_cache(),
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/node/eqr", response_model=NodeRealization)
async def node_realization_at(
    body: NodeKey, user: CurrentUserDep, session: SessionDep, cohort_id: uuid.UUID | None = None
) -> NodeRealization:
    """What the field won from this node onwards, overall and by holding (spec §10.4).

    The pool's half of EQR only: `realized` is EV as a share of the pot, and the caller divides
    it by the equity its own engine computed against the range it is holding (ADR-035).
    """
    cohort = cohort_spec(await load_cohort(session, user.id, cohort_id)) if cohort_id else None
    try:
        return await run_in_threadpool(
            node_realization, body, user.tenant_id, cohort=cohort, cache=report_cache()
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.get("/hands", response_model=list[HandSummary])
async def pool_hands(
    user: CurrentUserDep,
    date_from: date | None = None,
    date_to: date | None = None,
    stake_level: str | None = None,
    limit: Limit = 50,
) -> list[HandSummary]:
    """Recent hands from the pool, newest first (plan F.7).

    A pool hand has no hero seat, so each row opens on the seat worth watching: one that
    showed cards if any did, else the biggest winner. For hands where a *situation* happened,
    `POST /v1/hands/search` with `dataset: population` is the query to use.
    """
    refs = await run_in_threadpool(
        hand_query.pool_hand_refs,
        user.tenant_id,
        date_from=date_from,
        date_to=date_to,
        stake_level=stake_level,
        limit=limit,
    )
    return await run_in_threadpool(hand_query.summaries_for, user.tenant_id, refs)


@router.get("/presets", response_model=PoolPresetsOut)
def pool_presets(user: CurrentUserDep) -> PoolPresetsOut:
    """The pool area's landing reports and ready-made cohorts."""
    return PoolPresetsOut(reports=presets(), cohorts=cohort_service.cohort_presets())
