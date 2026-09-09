"""Per-client-address rate limit for the authentication routes.

Login and registration are the two endpoints an attacker hits in a loop: credential stuffing
on one, account spam on the other. A fixed window per address is crude but sufficient for
those, and it is one Redis INCR per request.

**Fails open.** A Redis outage disables the limiter rather than locking every user out of
sign-in -- the same trade `api/cache.py` makes, for the same reason: Redis is not
authoritative here. Per-tenant quotas with real accounting are POKER_PLAN.md step E.3.
"""

from __future__ import annotations

import logging

import redis
from fastapi import HTTPException, Request, status

from api import cache
from core.settings import get_settings

log = logging.getLogger(__name__)

WINDOW_SECONDS = 60


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


async def auth_rate_limit(request: Request) -> None:
    """FastAPI dependency: 429 once a client address exceeds the per-minute auth budget."""
    host = request.client.host if request.client else "unknown"
    if not hit(f"ratelimit:auth:{host}", get_settings().auth_rate_limit_per_minute):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts; try again in a minute"
        )
