"""`/v1/pool/node/*`: what the field does at one situation (spec §10, ADR-035).

Split out of `api/routers/pool.py`, which had reached its 300-line ceiling, along the line the
client already draws between the pool's *reports* and the pool's *node* tiers (ADR-065). The
prefix, the tag and the rate limit are `pool.py`'s own, so every URL is unchanged, and the two
cohort helpers are imported from it rather than copied, the way `hero.py` already imports them.
`report_cache` and `_bad_request` are *not* imported: every router module in `api/routers/`
declares its own `report_cache`, because that is the seam a unit test of this module would
patch -- patching `api.routers.pool`'s would no longer reach these four routes.

Four routes over one shared query (`analysis/pool/node_query.py`): the frequencies observed at
the node, the hands shown there, the prior reconstructed from them, and what the field realized
from the node onwards.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from analysis.pool.node_service import NodeFrequencies, NodeShowdownRange
from analysis.pool.node_service import frequencies as node_frequencies
from analysis.pool.node_service import showdown_range as node_showdown_range
from analysis.pool.nodes import NodeKey
from analysis.pool.realization import NodeRealization
from analysis.pool.realization import realization as node_realization
from analysis.pool.reconstruct import NodeEstimatedRange
from analysis.pool.reconstruct import estimated_range as node_estimate
from api import cache
from api.deps import CurrentUser, CurrentUserDep, SessionDep
from api.ratelimit import tenant_rate_limit
from api.routers.pool import PREFIX, TAG, cohort_spec, load_cohort
from api.schemas_pool import EstimateIn
from stats.errors import RegistryError, ReportError
from stats.request import CohortSpec
from stats.service import Cache

router = APIRouter(prefix=PREFIX, tags=[TAG], dependencies=[Depends(tenant_rate_limit)])


def report_cache() -> Cache | None:
    """The cache the services should use. Unit tests replace this with `None`."""
    return cache


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


async def _cohort(
    session: AsyncSession, user: CurrentUser, cohort_id: uuid.UUID | None
) -> CohortSpec | None:
    """The user's saved cohort as the engine's document, or None -- 404 for someone else's."""
    if cohort_id is None:
        return None
    return cohort_spec(await load_cohort(session, user.id, cohort_id))


@router.post("/node/frequencies", response_model=NodeFrequencies)
async def node_frequencies_at(
    body: NodeKey, user: CurrentUserDep, session: SessionDep, cohort_id: uuid.UUID | None = None
) -> NodeFrequencies:
    """Tier 1: what the field does at this situation (spec §10.2).

    The key's last step is not part of the question — it is one of the answers. Under `min_n`
    observations the answer carries the count and nothing else: no number here may be invented.
    """
    cohort = await _cohort(session, user, cohort_id)
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
    cohort = await _cohort(session, user, cohort_id)
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
    cohort = await _cohort(session, user, cohort_id)
    asked = (body.node, body.prior, user.tenant_id)
    try:
        return await run_in_threadpool(node_estimate, *asked, cohort=cohort, cache=report_cache())
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
    cohort = await _cohort(session, user, cohort_id)
    try:
        return await run_in_threadpool(
            node_realization, body, user.tenant_id, cohort=cohort, cache=report_cache()
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
