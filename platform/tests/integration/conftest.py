"""Integration-test fixtures.

**The event-loop problem, and why this fixture exists.** `api.db.engine` is created at import
time, and asyncpg binds its connection pool to whichever event loop first uses it.
pytest-asyncio gives each test a fresh loop, so the second test to run inherits a pool bound
to a dead loop and fails with "attached to a different loop".

Disposing the engine after every test drops the pool, so the next test builds a fresh one on
its own loop. It costs a handful of connection handshakes per test, which is nothing next to
the clarity of not sharing global async state between tests.

Production is unaffected: a long-lived server has exactly one loop, which is the case the
module-level engine is designed for.

**These tests write into the SAME ClickHouse the founder analyses.** The database name is
hardcoded (`core.*`) throughout the codebase, so there is no test database to point them at
without a wider refactor. Until there is, `_purge_test_tenants` below is what keeps the
analysis tables free of synthetic hands — see the note on that fixture.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import psycopg
import pytest

from api.db import clickhouse, engine
from api.settings import get_settings

CORE_TABLES = ("hands", "hand_players", "actions", "pot_winners")

TEST_EMAIL_PREFIX = "e2e-"
"""Integration tests register users as `e2e-<hex>@example.com`; that prefix is the only thing
distinguishing a throwaway tenant from a real one."""


@pytest.fixture(autouse=True)
async def _dispose_engine() -> AsyncIterator[None]:
    """Drop the asyncpg pool after each test so the next test gets a fresh one."""
    yield
    await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def _purge_test_tenants() -> Iterator[None]:
    """Delete every synthetic hand this suite wrote, once the session ends.

    **Why this is not merely tidiness.** The seed corpus is deliberately pathological — side
    pots, 3-bet all-ins, split pots — so its VPIP is around 41% against a real ~22%. Left in
    `core.*` it flows into `marts.player_hand_flags` on the next dbt run and shifts any query
    that is not scoped to a single `user_id`. A previous run left 384 such rows behind and they
    moved measured hero VPIP from 22.425% to 22.484%: a plausible number, quietly wrong, in a
    database whose entire purpose is deciding how to play.

    Scoped by the `e2e-` email prefix rather than by "not tenant 1", so it stays correct if
    real accounts are ever added.
    """
    yield
    with psycopg.connect(get_settings().postgres_dsn.replace("+asyncpg", ""), autocommit=True) as c:
        rows = c.execute(
            "SELECT DISTINCT tenant_id FROM users WHERE email LIKE %s", (f"{TEST_EMAIL_PREFIX}%",)
        ).fetchall()
    # Comma-joined, not `tuple(...)`: a one-element tuple formats as `(5,)` and the trailing
    # comma is not valid in a SQL IN list. Values are ints straight from the DB, never text.
    tenants = ",".join(str(int(r[0])) for r in rows)
    if not tenants:
        return
    client = clickhouse()
    for table in CORE_TABLES:
        client.command(
            f"ALTER TABLE core.{table} DELETE WHERE user_id IN ({tenants}) "
            f"SETTINGS mutations_sync=2"
        )
