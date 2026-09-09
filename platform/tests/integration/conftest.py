"""Integration-test fixtures: their own databases, provisioned per session, never the real ones.

**The guard comes first.** The founder's analysis lives in the unprefixed ClickHouse databases
and the `poker` Postgres database. This suite writes synthetic hands, so it may only run with
`CLICKHOUSE_DB_PREFIX=test_` and a Postgres database whose name ends in `_test` -- both set by
`make test-all` and by CI. Anything else aborts the session before a single test runs. An
earlier version wrote into the real tables and purged afterwards; a leak from that left 384
synthetic rows behind and moved measured hero VPIP from 22.425% to 22.484% -- a plausible
number, quietly wrong, in a database whose purpose is deciding how to play
(docs/POKER_AUDIT.md B12).

**The event-loop problem.** The engine is process-wide (lazily built, then cached), and
asyncpg binds its connection pool to whichever event loop first uses it. pytest-asyncio gives
each test a fresh loop, so the second test would inherit a pool bound to a dead loop and fail
with "attached to a different loop". Disposing the engine after every test drops the pool.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest

from api import provision
from api.db import get_engine
from ch import migrate as ch_migrate
from core.settings import get_settings
from ingestion.clickhouse import clickhouse

TEST_PREFIX = "test_"
TEST_DB_SUFFIX = "_test"
TEST_BUCKET_SUFFIX = "-test"
TEST_TOPIC_PREFIX = "test."
REAL_REDIS_DB = "/0"


def _refuse_unless_test_databases() -> None:
    """Every store a test can touch must be the test one, or the session does not start."""
    settings = get_settings()
    problems = []
    if settings.clickhouse_db_prefix != TEST_PREFIX:
        problems.append(f"CLICKHOUSE_DB_PREFIX must be {TEST_PREFIX!r}")
    if not settings.postgres_db.endswith(TEST_DB_SUFFIX):
        problems.append(f"POSTGRES_DB must end in {TEST_DB_SUFFIX!r}")
    if not settings.s3_raw_bucket.endswith(TEST_BUCKET_SUFFIX):
        problems.append(f"S3_RAW_BUCKET must end in {TEST_BUCKET_SUFFIX!r} (raw text is forever)")
    for topic in (settings.kafka_uploads_topic, settings.kafka_bulk_topic):
        if not topic.startswith(TEST_TOPIC_PREFIX):
            problems.append(f"Kafka topics must start with {TEST_TOPIC_PREFIX!r}, got {topic!r}")
    if not settings.kafka_consumer_group.startswith("test"):
        problems.append(
            "KAFKA_CONSUMER_GROUP must be a test group (a real one would consume "
            "real uploads into the test tables)"
        )
    if settings.redis_url.rstrip("/").endswith(REAL_REDIS_DB):
        problems.append(
            "REDIS_URL must use a logical database other than /0 (tenant ids "
            "collide between the real and test Postgres databases)"
        )
    if problems:
        pytest.exit(
            "refusing to run integration tests against the analysis databases: "
            + "; ".join(problems)
            + ". Use `make test-all`.",
            returncode=3,
        )


@pytest.fixture(scope="session", autouse=True)
def _test_databases() -> Iterator[None]:
    """Provision empty test databases for the session and drop them afterwards."""
    _refuse_unless_test_databases()
    client = clickhouse()
    ch_migrate.drop_all(client)
    provision.drop_postgres_database()
    provision.provision()
    yield
    ch_migrate.drop_all(client)
    provision.drop_postgres_database()


@pytest.fixture(autouse=True)
async def _dispose_engine() -> AsyncIterator[None]:
    """Drop the asyncpg pool after each test so the next test gets a fresh one."""
    yield
    await get_engine().dispose()
