"""The report cache's Redis client and the one write the ingest side makes to it (ADR-047).

The cache itself belongs to the API (`api/cache.py` reads and writes report results). It lives
one layer down for a single reason: the parser worker must be able to drop a tenant's cached
reports the moment a batch of hands has landed, or "stats are fresh seconds after an upload"
is true in ClickHouse and false on screen for `stats_cache_ttl_seconds`. The key namespace is
defined here so the writer and the invalidator cannot disagree about it.

**Nothing here is authoritative.** Every cached value is reconstructible from ClickHouse, so a
Redis outage degrades latency rather than correctness, and every helper fails open.
"""

from __future__ import annotations

import logging

import redis

from core.settings import get_settings

log = logging.getLogger(__name__)

STATS_PREFIX = "stats"
"""`api.cache.stats_key` writes `stats:{tenant_id}:...` -- tenant first, so the namespace is
physically partitioned and one tenant's invalidation cannot reach another's."""
REPORT_PREFIX = "report"
"""`stats.request.ReportRequest.cache_key` writes `report:{tenant_id}:{digest}`, and every report
the engine serves is cached under it. The invalidation once scanned `stats:` alone and so deleted
nothing a report had cached: an upload was in ClickHouse and not on screen for the cache's whole
TTL, with nothing red anywhere (plan D.8, ADR-051). `tests/test_cache_invalidation.py` pins both
writers to these prefixes."""
TENANT_PREFIXES: tuple[str, ...] = (STATS_PREFIX, REPORT_PREFIX)

_client: redis.Redis | None = None


def client() -> redis.Redis:
    """Process-wide Redis client."""
    global _client
    if _client is None:
        _client = redis.from_url(get_settings().redis_url, decode_responses=True)
    return _client


def invalidate_tenant(tenant_id: int) -> int:
    """Drop every cached block for one tenant, after new hands land. Never raises.

    `scan_iter`, not `KEYS`: KEYS blocks the whole server while it walks the keyspace, which
    on a shared cache is an outage. SCAN is incremental.
    """
    try:
        conn = client()
        removed = 0
        for prefix in TENANT_PREFIXES:
            for key in conn.scan_iter(match=f"{prefix}:{tenant_id}:*", count=500):
                conn.delete(key)
                removed += 1
        return removed
    except redis.RedisError as exc:
        log.warning("redis invalidate failed: %s", exc)
        return 0
