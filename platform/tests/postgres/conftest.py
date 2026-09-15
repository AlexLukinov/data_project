"""Fixtures for suites that need **Postgres only**: a scratch database, migrated, then dropped.

Why these are not under `tests/integration/`: that package's session fixture drops and
re-provisions the ClickHouse `test_` databases and rebuilds the empty marts, because its tests
ingest hands. A suite whose every query is Postgres -- notes and tags on a hand (plan D.7b),
with ownership faked at the HTTP edge -- can therefore run while another session owns the
ClickHouse test namespace, against any Postgres database whose name ends in `_test`:

    POSTGRES_DB=poker_d7b_test CLICKHOUSE_DB_PREFIX=scratch_ REDIS_URL=redis://localhost:6380/2 \\
      AUTH_RATE_LIMIT_PER_MINUTE=1000 uv run pytest tests/postgres

**The guard comes first, and it is stricter about ClickHouse than the integration one, not
looser.** The Postgres name must end in `_test` (as `provision.drop_postgres_database` also
insists). The ClickHouse prefix must be *set* -- any value but the empty string -- so that a
route these tests reach by mistake fails on an unknown database instead of reading the
founder's real hands. Redis must not be the real logical database, because tenant ids in a
scratch Postgres collide with the real ones and the rate-limit and budget counters are keyed
on them. Under `make test-all` all three hold already.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from urllib.parse import urlparse

import pytest

from api import provision
from api.db import get_engine
from api.main import app
from api.routers.hands import owned_hand
from core.settings import get_settings
from tests.postgres import support

TEST_DB_SUFFIX = "_test"
REAL_REDIS_DB = "0"


def redis_database(url: str) -> str:
    """The logical database a Redis URL names: the path, or `0` when it names none."""
    return urlparse(url).path.strip("/") or REAL_REDIS_DB


def _refuse_unless_scratch() -> None:
    """Every store a test here can touch must be a scratch one, or the session does not start."""
    settings = get_settings()
    problems = []
    if not settings.postgres_db.endswith(TEST_DB_SUFFIX):
        problems.append(f"POSTGRES_DB must end in {TEST_DB_SUFFIX!r}")
    if settings.clickhouse_db_prefix == "":
        problems.append(
            "CLICKHOUSE_DB_PREFIX must be set (these tests never read ClickHouse, and a "
            "prefix makes sure a stray query cannot reach the real databases)"
        )
    # A URL with no path is database 0 too; checking the parsed path rather than the suffix
    # is what makes that case refused as well.
    if redis_database(settings.redis_url) == REAL_REDIS_DB:
        problems.append("REDIS_URL must name a logical database other than 0")
    if problems:
        pytest.exit(
            "refusing to run the Postgres suites outside a scratch environment: "
            + "; ".join(problems),
            returncode=3,
        )


@pytest.fixture(scope="session", autouse=True)
def _postgres_database() -> Iterator[None]:
    """Create and migrate the scratch Postgres database for the session; drop it afterwards."""
    _refuse_unless_scratch()
    provision.ensure_postgres_database()
    provision.migrate_postgres()
    yield
    provision.drop_postgres_database()


@pytest.fixture(autouse=True)
async def _dispose_engine() -> AsyncIterator[None]:
    """Drop the asyncpg pool after each test: it binds to the loop that first used it, and
    pytest-asyncio gives every test a fresh loop (see `tests/integration/conftest.py`)."""
    yield
    await get_engine().dispose()


@pytest.fixture(autouse=True)
async def _fake_ownership() -> AsyncIterator[None]:
    """Stand `support.OWNED` in for `core.hands`: who owns which hand, with no ClickHouse."""
    app.dependency_overrides[owned_hand] = support.fake_owned_hand
    yield
    app.dependency_overrides.pop(owned_hand, None)
    support.OWNED.clear()
