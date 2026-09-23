"""`/v1/pool/node/*`: what the field does at one situation (spec §10, ADR-035).

Split out of `api/routers/pool.py`, which had reached its 300-line ceiling, along the line the
client already draws between the pool's *reports* and the pool's *node* tiers (ADR-065). The
prefix, the tag and the rate limit are `pool.py`'s own, so every URL is unchanged, and the
cohort resolver is imported from it rather than copied, the way `hero.py` imports its helpers.
`report_cache` and `_bad_request` are *not* imported: every router module in `api/routers/`
declares its own `report_cache`, because that is the seam a unit test of this module would
patch -- patching `api.routers.pool`'s would no longer reach these four routes.

Four routes over one shared query (`analysis/pool/node_query.py`): the frequencies observed at
the node, the hands shown there, the prior reconstructed from them, and what the field realized
from the node onwards. Each takes the players to ask about by a saved cohort's `cohort_id`
or by a `cohort` key -- `preset:<code>` for a shipped preset, `group:<key>` for an ADR-080
group -- so a reader who never saved "reg" can still ask what regs do here (plan G.4).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
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
from api.deps import CurrentUserDep, SessionDep
from api.ratelimit import tenant_rate_limit
from api.routers.pool import PREFIX, TAG, resolve_cohort
from api.schemas_pool import EstimateIn
from stats.errors import RegistryError, ReportError
from stats.service import Cache

router = APIRouter(prefix=PREFIX, tags=[TAG], dependencies=[Depends(tenant_rate_limit)])


def report_cache() -> Cache | None:
    """The cache the services should use. Unit tests replace this with `None`."""
    return cache


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.post("/node/frequencies", response_model=NodeFrequencies)
async def node_frequencies_at(
    body: NodeKey,
    user: CurrentUserDep,
    session: SessionDep,
    cohort_id: uuid.UUID | None = None,
    cohort: str | None = None,
) -> NodeFrequencies:
    """Tier 1: what the field does at this situation (spec §10.2).

    The key's last step is not part of the question — it is one of the answers. Every
    frequency comes with its interval, clustered by player (ADR-076); under the gate the
    answer carries the count, the players and what the node would need, and no number.
    """
    scoped = await resolve_cohort(session, user, cohort_id, cohort)
    try:
        return await run_in_threadpool(
            node_frequencies, body, user.tenant_id, cohort=scoped, cache=report_cache()
        )
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc


@router.post("/node/showdown-range", response_model=NodeShowdownRange)
async def node_showdown_range_at(
    body: NodeKey,
    user: CurrentUserDep,
    session: SessionDep,
    cohort_id: uuid.UUID | None = None,
    cohort: str | None = None,
) -> NodeShowdownRange:
    """Tier 2: the hands the field turned over at this situation (spec §10.3).

    `covers` says what share of the node's decisions were ever revealed, so the caller can
    show the range for what it is: the hands shown here, not the hands played here.
    """
    scoped = await resolve_cohort(session, user, cohort_id, cohort)
    try:
        return await run_in_threadpool(
            node_showdown_range, body, user.tenant_id, cohort=scoped, cache=report_cache()
        )
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc


@router.post("/node/estimated-range", response_model=NodeEstimatedRange)
async def node_estimated_range_at(
    body: EstimateIn,
    user: CurrentUserDep,
    session: SessionDep,
    cohort_id: uuid.UUID | None = None,
    cohort: str | None = None,
) -> NodeEstimatedRange:
    """Tier 3: the prior reweighted by what the field does with each class (spec §10.3).

    The key's last step is the action being explained. `implied_frequency` against
    `observed_frequency` is the reconstruction checking its own work: they agree only if the
    per-class rates really do produce the frequency tier 1 measured directly.
    """
    scoped = await resolve_cohort(session, user, cohort_id, cohort)
    asked = (body.node, body.prior, user.tenant_id)
    try:
        return await run_in_threadpool(node_estimate, *asked, cohort=scoped, cache=report_cache())
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/node/eqr", response_model=NodeRealization)
async def node_realization_at(
    body: NodeKey,
    user: CurrentUserDep,
    session: SessionDep,
    cohort_id: uuid.UUID | None = None,
    cohort: str | None = None,
) -> NodeRealization:
    """What the field won from this node onwards, overall and by holding (spec §10.4).

    The pool's half of EQR only: `realized` is EV as a share of the pot, and the caller divides
    it by the equity its own engine computed against the range it is holding (ADR-035).
    """
    scoped = await resolve_cohort(session, user, cohort_id, cohort)
    try:
        return await run_in_threadpool(
            node_realization, body, user.tenant_id, cohort=scoped, cache=report_cache()
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
