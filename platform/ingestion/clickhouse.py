"""The process-wide ClickHouse client. Owned by `ingestion`, used by everything above it.

clickhouse-connect keeps an internal HTTP connection pool, so one client per process is correct
-- a client per request would throw away the pool. The factory lived in `api/db.py` until
2026-09-09, which made the parser worker and the bulk importer import the web layer to reach the
database (docs/POKER_AUDIT.md B10, ADR-023).

**Sessions are turned off.** By default the driver stamps every request with one session id, and
ClickHouse refuses a second query inside a session while the first is running -- so two requests
that both read ClickHouse (the analyzer asks for a hand and for the pool's frequencies at once)
fail with "Attempt to execute concurrent queries within the same session". Nothing here needs a
session: no temporary tables, no session-scoped settings, every query is self-contained.
"""

from __future__ import annotations

from functools import lru_cache

import clickhouse_connect
from clickhouse_connect import common
from clickhouse_connect.driver.client import Client

from core.settings import get_settings


@lru_cache(maxsize=1)
def clickhouse() -> Client:
    """Return the process-wide ClickHouse client, built from settings on first use."""
    settings = get_settings()
    # Set before the client is built: the id is stamped on at construction.
    common.set_setting("autogenerate_session_id", False)
    return clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
        query_limit=0,
    )
