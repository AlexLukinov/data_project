"""Request budgets, kept in Redis: per client address on the auth routes, per tenant elsewhere.

Two different things are being defended, so there are two keys.

**Per address, on the unauthenticated auth routes.** Login, registration and refresh are the
endpoints an attacker hits in a loop: credential stuffing on one, account spam on the second,
token guessing on the third. There is no tenant yet on any of them -- that is the point of the
request -- so the only identity available is the client address.

**Per tenant, on the analytics routes.** Once a caller is authenticated the address is the wrong
key: one tenant behind a shared address would throttle another, and one tenant across many
addresses would not be throttled at all. These routes are also the expensive ones, so the budget
here is about fairness on a small node rather than about credentials.

**This is the cheap half of the budget, and it is not the load-bearing one.** A limit checked in
the API is only a limit for callers that come through the API; the query-cost budget that no path
can dodge lives in ClickHouse's own settings profiles and quotas (`api/ch_tenancy.py`, ADR-043).
This module bounds *requests*; that one bounds *work*.

**Fails open.** A Redis outage disables the limiter rather than locking everyone out -- the same
trade `api/cache.py` makes, for the same reason: Redis is not authoritative here. Note that the
compose Redis runs `--maxmemory-policy allkeys-lru`, so a counter can also be evicted under
pressure; both are acceptable for a fairness budget and would not be for an accounting one.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

import redis
from fastapi import HTTPException, Request, status

from api import cache
from api.deps import CurrentUserDep
from core.settings import get_settings

log = logging.getLogger(__name__)

WINDOW_SECONDS = 60

TENANT_REQUESTS_PER_MINUTE = 300
"""Analytics requests one tenant may make per minute (F-706).

Not a setting, deliberately: `core/settings.py` was owned by another session when this landed
(see ADR-043), and a constant that is read in one place is easy to promote later. Sized well
above any page the UI draws -- the reports workbench issues one request per grid, not per cell --
and well below what would keep a 2-thread ClickHouse busy for a minute.
"""

RETRY_AFTER_SECONDS = str(WINDOW_SECONDS)


def hit(key: str, limit: int, *, window_seconds: int = WINDOW_SECONDS) -> bool:
    """Count one request under `key`. True while the window's budget is not exceeded."""
    try:
        conn = cache.client()
        count = int(conn.incr(key))
        if count == 1:
            conn.expire(key, window_seconds)
        return count <= limit
    except redis.RedisError as exc:
        log.warning("rate limiter unavailable, allowing request: %s", exc)
        return True


def _too_many(detail: str) -> HTTPException:
    """A 429 that tells the client when to come back rather than making it guess."""
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS, detail, headers={"Retry-After": RETRY_AFTER_SECONDS}
    )


def by_address(bucket: str) -> Callable[[Request], Awaitable[None]]:
    """Build a dependency that spends one unit of `bucket`'s budget for this client address.

    One bucket per route family rather than one shared bucket, so a burst of token refreshes
    from a browser cannot spend the budget that stops credential stuffing on sign-in.
    """

    async def dependency(request: Request) -> None:
        host = request.client.host if request.client else "unknown"
        if not hit(f"ratelimit:{bucket}:{host}", get_settings().auth_rate_limit_per_minute):
            raise _too_many("Too many attempts; try again in a minute")

    return dependency


auth_rate_limit = by_address("auth")
"""Registration and sign-in: the credential-stuffing surface."""

refresh_rate_limit = by_address("refresh")
"""Token refresh: unauthenticated, so it gets a budget of its own rather than sign-in's."""


async def tenant_rate_limit(user: CurrentUserDep) -> None:
    """FastAPI dependency: 429 once one tenant exceeds its per-minute request budget.

    Keyed on the tenant from the token, never on anything the caller sends. Attached at router
    level so a new analytics endpoint inherits it instead of having to remember it.
    """
    if not hit(f"ratelimit:tenant:{user.tenant_id}", TENANT_REQUESTS_PER_MINUTE):
        raise _too_many("Too many requests for this account; try again in a minute")
