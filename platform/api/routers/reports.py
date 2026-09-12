"""`POST /v1/reports/run`: any stat, any situation, any grouping -- one endpoint (plan §2.7).

The body is the engine's `ReportRequest`; the answer is its `ReportResult`. Tenancy comes from
the token: the request document has no tenant field, and the service takes `tenant_id` as an
argument. A malformed document is a 422 from validation; a well-formed one the registry cannot
answer (unknown stat, a dimension the stat's table lacks) is a 400 that names the mistake.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from api import cache
from api.deps import CurrentUserDep
from api.ratelimit import tenant_rate_limit
from stats.errors import RegistryError, ReportError
from stats.request import ReportRequest, ReportResult
from stats.service import Cache, run_report

router = APIRouter(
    prefix="/v1/reports", tags=["reports"], dependencies=[Depends(tenant_rate_limit)]
)


def report_cache() -> Cache | None:
    """The cache the service should use. Unit tests replace this with `None`."""
    return cache


@router.post("/run", response_model=ReportResult)
def run(body: ReportRequest, user: CurrentUserDep) -> ReportResult:
    """Run a report.

    Synchronous on purpose: the ClickHouse client is blocking, and FastAPI runs a plain `def`
    route in its thread pool instead of stalling the event loop.
    """
    try:
        return run_report(body, tenant_id=user.tenant_id, cache=report_cache())
    except (ReportError, RegistryError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
