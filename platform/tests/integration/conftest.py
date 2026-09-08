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
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from api.db import engine


@pytest.fixture(autouse=True)
async def _dispose_engine() -> AsyncIterator[None]:
    """Drop the asyncpg pool after each test so the next test gets a fresh one."""
    yield
    await engine.dispose()
