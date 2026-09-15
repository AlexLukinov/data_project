"""Redis cache for hot stat blocks.

**Nothing here is authoritative.** Every value is reconstructible from ClickHouse, so LRU
eviction is correct behaviour rather than data loss, and a Redis outage degrades latency
rather than correctness — every helper below fails open.

Cache keys are namespaced by tenant (`stats:{tenant_id}:...`) so one tenant can never read
another's cached block even if a key collision were somehow constructed. The client and the
invalidation live in `ingestion.cache`, because the parser worker drops a tenant's blocks when
its hands land (ADR-047); this module adds the reads and writes the API makes.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

import redis

from core.settings import get_settings
from ingestion.cache import STATS_PREFIX, client, invalidate_tenant

__all__ = ["client", "get_json", "invalidate_tenant", "set_json", "stats_key"]

log = logging.getLogger(__name__)


def stats_key(tenant_id: int, kind: str, payload: dict[str, Any]) -> str:
    """Build a cache key. Tenant first, so the namespace is physically partitioned."""
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[
        :20
    ]
    return f"{STATS_PREFIX}:{tenant_id}:{kind}:{digest}"


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
