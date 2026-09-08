"""Database connections: async Postgres session and a ClickHouse client factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

import clickhouse_connect
from clickhouse_connect.driver.client import Client
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.settings import get_settings

_settings = get_settings()

# `expire_on_commit=False` so response models can still read attributes after commit --
# otherwise every commit triggers a lazy refresh, and `lazy="raise"` on the relationships
# turns that into an exception.
engine = create_async_engine(_settings.postgres_dsn, pool_pre_ping=True, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a transactional session."""
    async with SessionLocal() as session:
        yield session


@lru_cache(maxsize=1)
def clickhouse() -> Client:
    """Process-wide ClickHouse client.

    clickhouse-connect keeps an internal HTTP connection pool and is thread-safe, so one
    client per process is correct -- a client per request would throw away the pool.
    """
    settings = get_settings()
    return clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
        query_limit=0,
    )
