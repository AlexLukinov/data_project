"""The per-tenant ClickHouse budget, everything about it that needs no server (plan E.3).

Two things are checked here because they are the two ways this step can be quietly wrong:
the DDL text, statement by statement, and the classification of a refusal -- a budget rejection
must never be reported as a server fault and a server fault must never be reported to the caller
as "you asked for too much".

What a unit test cannot check is that ClickHouse accepts this syntax and enforces it. That is
`tests/integration/test_quotas.py`.
"""

from __future__ import annotations

import hashlib

import pytest
from clickhouse_connect.driver.exceptions import DatabaseError, OperationalError

from stats import tenancy
from stats.budget import (
    STANDARD,
    Budget,
    drop_statements,
    password,
    profile_name,
    quota_name,
    shared_statements,
    statements,
    tier_statements,
    user_name,
)

SECRET = "admin-secret"
GRANTS = ("test_marts.*", "system.settings")

TINY = Budget(
    name="tiny",
    max_memory_bytes=1_000_000,
    max_execution_seconds=1,
    max_rows_to_read=10,
    max_result_rows=5,
    max_concurrent_queries=1,
    queries_per_hour=1,
    read_rows_per_hour=100,
    execution_seconds_per_hour=2,
)


def _ddl(tenant_id: int = 7, budget: Budget = STANDARD) -> tuple[str, ...]:
    return statements("test_", tenant_id, budget, GRANTS, SECRET)


def test_names_carry_the_database_prefix() -> None:
    """Tenant 3 of the test databases and tenant 3 of the real ones are different accounts."""
    assert user_name("test_", 3) == "poker_tenant_test_3"
    assert user_name("", 3) == "poker_tenant_3"
    assert quota_name("test_", 3) == "poker_quota_test_3"
    assert user_name("test_", 3) != user_name("", 3)


def test_the_profile_is_named_after_the_tier_not_the_tenant() -> None:
    """Tenants on one tier share one profile, so a tier change is a reassignment."""
    assert profile_name(STANDARD) == "poker_budget_standard"
    assert profile_name(TINY) == "poker_budget_tiny"


def test_an_identifier_that_could_carry_sql_is_refused() -> None:
    with pytest.raises(ValueError, match="refusing to send"):
        user_name("test_'; DROP USER x; --", 1)


def test_the_password_is_derived_per_tenant_and_never_the_admin_secret() -> None:
    one, two = password(SECRET, "poker_tenant_1"), password(SECRET, "poker_tenant_2")
    assert one != two
    assert SECRET not in one
    assert password(SECRET, "poker_tenant_1") == one, "must be stable across processes"
    assert password("other-secret", "poker_tenant_1") != one


def test_only_the_hash_of_the_password_appears_in_the_ddl() -> None:
    """The plaintext is derived on both sides; the server only ever sees sha256 of it."""
    plain = password(SECRET, "poker_tenant_test_7")
    hashed = hashlib.sha256(plain.encode()).hexdigest()
    ddl = "\n".join(_ddl())
    assert f"IDENTIFIED WITH sha256_hash BY '{hashed}'" in ddl
    assert plain not in ddl and SECRET not in ddl


def test_every_ceiling_is_const_so_the_connection_cannot_raise_it() -> None:
    create = _ddl()[0]
    for setting, value in STANDARD.query_settings().items():
        assert f"{setting} = {value} CONST" in create, setting
    # Not CONST, deliberately: ClickHouse refuses to lower `readonly` on its own, and the driver
    # legitimately sets other settings per query.
    assert "readonly = 2" in create and "readonly = 2 CONST" not in create


def test_the_quota_is_hourly_keyed_and_attached_to_the_tenant() -> None:
    quota = next(s for s in _ddl() if s.startswith("CREATE QUOTA"))
    assert "KEYED BY user_name" in quota
    assert "FOR INTERVAL 1 HOUR" in quota
    assert "queries = 3600" in quota
    assert "read_rows = 10000000000" in quota
    assert "execution_time = 1800" in quota
    assert quota.endswith("TO poker_tenant_test_7")


def test_every_statement_is_idempotent() -> None:
    """Re-running provisioning must never fail and never reset a quota's consumption."""
    for statement in _ddl():
        assert "IF NOT EXISTS" in statement or statement.startswith(("ALTER ", "GRANT ")), statement


def test_the_create_then_alter_pair_keeps_the_server_in_step_with_this_file() -> None:
    """A tenant provisioned last month must end up on today's numbers, not last month's."""
    ddl = _ddl()
    assert ddl[0].startswith("CREATE SETTINGS PROFILE IF NOT EXISTS poker_budget_standard")
    assert ddl[1].startswith("ALTER SETTINGS PROFILE poker_budget_standard SETTINGS ")
    # rsplit: "CREATE SETTINGS PROFILE ... SETTINGS ..." has two occurrences of the word.
    assert ddl[0].rsplit(" SETTINGS ", 1)[1] == ddl[1].rsplit(" SETTINGS ", 1)[1]
    quota = [s for s in ddl if "QUOTA" in s]
    assert (
        quota[0].split(" MAX ", 1)[1].removesuffix(" TO poker_tenant_test_7")
        == (quota[1].split(" MAX ", 1)[1])
    )


def test_the_tenant_is_granted_select_on_what_it_reads_and_nothing_else() -> None:
    grants = [s for s in _ddl() if s.startswith("GRANT")]
    assert grants == [
        "GRANT SELECT ON test_marts.* TO poker_tenant_test_7",
        "GRANT SELECT ON system.settings TO poker_tenant_test_7",
    ]
    assert not any("core" in g for g in grants), "core is read on the admin connection"
    assert not any("INSERT" in s or "ALTER TABLE" in s for s in _ddl())


def test_dropping_a_tenant_leaves_the_tier_profile_alone() -> None:
    dropped = drop_statements("test_", 7)
    assert dropped == (
        "DROP QUOTA IF EXISTS poker_quota_test_7",
        "DROP USER IF EXISTS poker_tenant_test_7",
    )
    assert not any("PROFILE" in s for s in dropped)


@pytest.mark.parametrize(
    ("code", "status_code"),
    [
        (tenancy.QUOTA_EXCEEDED, 429),
        (tenancy.TOO_MANY_ROWS_OR_BYTES, 400),
        (tenancy.MEMORY_LIMIT_EXCEEDED, 400),
        (tenancy.TIMEOUT_EXCEEDED, 504),
        (tenancy.SETTING_CONSTRAINT_VIOLATION, 400),
    ],
)
def test_a_budget_refusal_maps_to_a_status_that_says_what_happened(
    code: int, status_code: int
) -> None:
    found = tenancy.rejection(DatabaseError("server said something", code=code))
    assert found is not None
    assert found.status_code == status_code
    assert found.clickhouse == tenancy.NAMES[code]
    assert "server said something" not in found.detail, "never forward the server's own text"


def test_a_retried_refusal_is_classified_too() -> None:
    """The driver raises `OperationalError` when the request had been retried."""
    found = tenancy.rejection(OperationalError("retried", code=tenancy.QUOTA_EXCEEDED))
    assert found is not None and found.status_code == 429


@pytest.mark.parametrize("exc", [DatabaseError("gone", code=60), DatabaseError("no code")])
def test_anything_that_is_not_a_budget_refusal_is_not_classified(exc: DatabaseError) -> None:
    """An unknown table or an unreachable server must not be reported as 'too expensive'."""
    assert tenancy.rejection(exc) is None


def test_connecting_to_a_tenant_never_moves_it_off_its_tier() -> None:
    """The bug this pair exists to stop: a reconnect re-tiered every tenant to STANDARD.

    `shared_statements` is what a cache miss sends, so nothing in it may assign a profile or
    restate a quota's ceiling -- otherwise putting a tenant on a smaller budget lasts exactly
    until the next connection, and `Budget.name` means nothing.
    """
    shared = shared_statements("test_", 7, STANDARD, GRANTS, SECRET)
    assert not any("SETTINGS PROFILE" in s and s.startswith("ALTER USER") for s in shared)
    assert not any(s.startswith("ALTER QUOTA") for s in shared)
    # It must still be able to connect and read after one of these passes.
    assert any(s.startswith("CREATE USER IF NOT EXISTS") for s in shared)
    assert any(s.startswith("GRANT SELECT") for s in shared)


def test_the_tier_statements_are_exactly_what_statements_adds() -> None:
    """One list, split in one place: `statements` stays the full assignment it claims to be."""
    assert _ddl(budget=TINY) == (
        *shared_statements("test_", 7, TINY, GRANTS, SECRET),
        *tier_statements("test_", 7, TINY),
    )
    assert tier_statements("test_", 7, TINY) == (
        "ALTER USER poker_tenant_test_7 SETTINGS PROFILE poker_budget_tiny",
        "ALTER QUOTA poker_quota_test_7 FOR INTERVAL 1 HOUR MAX "
        "queries = 1, read_rows = 100, execution_time = 2",
    )
