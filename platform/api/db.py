"""Postgres sessions for the API. Built lazily, on first use, never at import.

An engine created at import time meant that importing anything that touched `api.db` --
the worker, the migration runner, a test module -- constructed a database engine as a side
effect, and made the engine impossible to reconfigure for tests (docs/POKER_AUDIT.md B10).
The ClickHouse client lives in `ingestion.clickhouse`; it is re-exported here only so API
code has one place to import database handles from.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.settings import get_settings
from ingestion.clickhouse import clickhouse

__all__ = ["clickhouse", "get_engine", "get_session", "session_factory"]


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    """The process-wide async engine, created on first call."""
    return create_async_engine(get_settings().postgres_dsn, pool_pre_ping=True, future=True)


@lru_cache(maxsize=1)
def session_factory() -> async_sessionmaker[AsyncSession]:
    """Session factory bound to the engine.

    `expire_on_commit=False` so response models can still read attributes after commit --
    otherwise every commit triggers a lazy refresh, and `lazy="raise"` on the relationships
    turns that into an exception.
    """
    return async_sessionmaker(get_engine(), expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a transactional session."""
    async with session_factory()() as session:
        yield session
