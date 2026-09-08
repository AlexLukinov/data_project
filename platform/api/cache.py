"""Redis cache for hot stat blocks.

**Nothing here is authoritative.** Every value is reconstructible from ClickHouse, so LRU
eviction is correct behaviour rather than data loss, and a Redis outage degrades latency
rather than correctness — every helper below fails open.

Cache keys are namespaced by tenant (`stats:{tenant_id}:...`) so one tenant can never read
another's cached block even if a key collision were somehow constructed.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

import redis

from api.settings import get_settings

log = logging.getLogger(__name__)
_client: redis.Redis | None = None


def client() -> redis.Redis:
    """Process-wide Redis client."""
    global _client
    if _client is None:
        _client = redis.from_url(get_settings().redis_url, decode_responses=True)
    return _client


def stats_key(tenant_id: int, kind: str, payload: dict[str, Any]) -> str:
    """Build a cache key. Tenant first, so the namespace is physically partitioned."""
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[
        :20
    ]
    return f"stats:{tenant_id}:{kind}:{digest}"


def get_json(key: str) -> Any | None:
    """Read a cached value, or None.

    Never raises: to the caller, a cache miss and a cache outage are the same thing.
    """
    try:
        raw = client().get(key)
    except redis.RedisError as exc:
        log.warning("redis get failed, serving uncached: %s", exc)
        return None
    return json.loads(raw) if raw else None


def set_json(key: str, value: Any, ttl: int | None = None) -> None:
    """Write a cached value. Never raises."""
    settings = get_settings()
    try:
        client().set(
            key,
            json.dumps(value, default=str),
            ex=ttl or settings.stats_cache_ttl_seconds,
        )
    except redis.RedisError as exc:
        log.warning("redis set failed, continuing uncached: %s", exc)


def invalidate_tenant(tenant_id: int) -> int:
    """Drop every cached block for one tenant, after new hands land.

    `scan_iter`, not `KEYS`: KEYS blocks the whole server while it walks the keyspace, which
    on a shared cache is an outage. SCAN is incremental.
    """
    try:
        conn = client()
        removed = 0
        for key in conn.scan_iter(match=f"stats:{tenant_id}:*", count=500):
            conn.delete(key)
            removed += 1
        return removed
    except redis.RedisError as exc:
        log.warning("redis invalidate failed: %s", exc)
        return 0
