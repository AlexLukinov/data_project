"""The per-tenant query budget, expressed as ClickHouse access-control DDL (plan E.3, F-208).

**Why the budget cannot live in Python.** An `if` in the API is a limit for callers that come
through the API. Anything else with the database credential -- the parser worker, a `dbt` run, a
SQL prompt, a future service, a bug -- walks straight past it. So the budget is declared to the
server: each tenant gets a ClickHouse **user** whose **settings profile** caps one query's cost
and whose **quota** caps its consumption over an hour. ClickHouse then rejects the over-budget
query itself, and the API's only job is to turn that rejection into an HTTP status.

**Why `CONST`.** Every capped setting is marked `CONST` (ClickHouse spells the same constraint
`READONLY`), so the connection cannot raise its own ceiling: attempting it is
`SETTING_CONSTRAINT_VIOLATION`, not a bigger budget. `readonly = 2` beside it means the
connection can read and can pass harmless settings but cannot write -- defence in depth next to
`GRANT SELECT`, so a compromised query path cannot mutate a mart.

This module is pure: it builds strings and hashes them, and touches no connection, so every
statement below is asserted by a unit test that needs no server (`tests/test_ch_budget.py`).
The numbers are sized against the node that `infra/clickhouse/limits.xml` and
`docs/POKER_SCALE.md` §1 define -- keep all three in step.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass

NAME = re.compile(r"^[a-z][a-z0-9_]{2,62}$")
"""Every generated ClickHouse identifier must match this, or nothing is sent.

The names are built from an integer tenant id and the settings' database prefix, so they cannot
carry a quote today; asserting it anyway is how that stays true when the prefix changes.
"""

USER_PREFIX = "poker_tenant_"
QUOTA_PREFIX = "poker_quota_"
PROFILE_PREFIX = "poker_budget_"

QUOTA_INTERVAL = "1 HOUR"


@dataclass(frozen=True, slots=True)
class Budget:
    """One tier's ceiling: what a single query may cost, and what an hour of them may cost.

    `name` names the settings profile, so tenants on the same tier share one profile object and
    a tier change is a reassignment rather than a rewrite.
    """

    name: str
    max_memory_bytes: int
    max_execution_seconds: int
    max_rows_to_read: int
    max_result_rows: int
    max_concurrent_queries: int
    queries_per_hour: int
    read_rows_per_hour: int
    execution_seconds_per_hour: int

    def query_settings(self) -> dict[str, int]:
        """The per-query ceilings, in ClickHouse's own setting names."""
        return {
            "max_memory_usage": self.max_memory_bytes,
            "max_execution_time": self.max_execution_seconds,
            "max_rows_to_read": self.max_rows_to_read,
            "max_result_rows": self.max_result_rows,
            "max_concurrent_queries_for_user": self.max_concurrent_queries,
        }

    def hourly_limits(self) -> dict[str, int]:
        """The quota's resources, in ClickHouse's own quota-limit names."""
        return {
            "queries": self.queries_per_hour,
            "read_rows": self.read_rows_per_hour,
            "execution_time": self.execution_seconds_per_hour,
        }


STANDARD = Budget(
    name="standard",
    # Above the 0.98 GiB measured for the heaviest pool scan (POKER_SCALE.md §4.2) and below the
    # 2.5 GB server-wide ceiling in limits.xml, so a tenant query is refused while there is
    # still room for the refusal to be handled.
    max_memory_bytes=1_500_000_000,
    # The measured pool-wide arbitrary situation is 1.6 s at two threads (POKER_SCALE.md §2).
    max_execution_seconds=60,
    # `marts.decisions` is 73.7M rows and a legitimate pool report scans all of it; this is
    # ~5x that, so it rejects a runaway join rather than an honest full scan.
    max_rows_to_read=400_000_000,
    # `stats/request.py` caps a report at MAX_LIMIT = 10,000 rows; this catches a group-by whose
    # cardinality nobody predicted.
    max_result_rows=1_000_000,
    # The server allows 16 concurrent queries (small-node.xml); one tenant may hold a quarter.
    max_concurrent_queries=4,
    queries_per_hour=3_600,
    # ~135 full scans of today's `decisions` per hour.
    read_rows_per_hour=10_000_000_000,
    # Half an hour of query time per hour, which on a two-thread node is already half the box.
    execution_seconds_per_hour=1_800,
)
"""The only tier in use. F-208 is written per tier and F-704 (billing) is what chooses one;
until then every tenant is standard, and `ensure` takes the budget as an argument so a test --
or a future tier -- can hand it a different one without a schema change."""


def profile_name(budget: Budget) -> str:
    """The settings-profile object for a tier."""
    return _checked(f"{PROFILE_PREFIX}{budget.name}")


def user_name(db_prefix: str, tenant_id: int) -> str:
    """The ClickHouse user for one tenant.

    The database prefix is part of the name on purpose: tenant ids are allocated by Postgres and
    the real and test databases each have their own sequence, so tenant 3 of `poker_test` and
    tenant 3 of `poker` are different accounts. Without the prefix they would share a user, a
    quota and a budget -- the same collision the integration conftest guards for Redis.
    """
    return _checked(f"{USER_PREFIX}{db_prefix}{tenant_id}")


def quota_name(db_prefix: str, tenant_id: int) -> str:
    """The quota object for one tenant."""
    return _checked(f"{QUOTA_PREFIX}{db_prefix}{tenant_id}")


def password(secret: str, username: str) -> str:
    """The tenant user's password, derived rather than stored.

    HMAC of the username under the admin ClickHouse password: nothing new to keep, nothing new
    to leak, and one tenant's password reveals neither another's nor the admin's. Only its
    SHA-256 ever reaches the server (`sha256_hash`), and `ensure` re-applies it on every
    provisioning pass, so rotating `CLICKHOUSE_PASSWORD` heals on the next process start rather
    than locking the tenant out.
    """
    return hmac.new(secret.encode(), username.encode(), hashlib.sha256).hexdigest()


def statements(
    db_prefix: str, tenant_id: int, budget: Budget, grants: tuple[str, ...], secret: str
) -> tuple[str, ...]:
    """Every statement needed to put one tenant **on** one budget. Idempotent, in order.

    `grants` are ClickHouse grant targets, already spelled: `"test_marts.*"`, `"system.settings"`.

    `CREATE ... IF NOT EXISTS` then `ALTER`: the create is what makes a new tenant work, the
    alter is what keeps an existing one in step with the numbers above, so this file stays the
    single source of truth rather than drifting from whatever the server was first given.

    The last two statements are the ones that *bind* the tenant to `budget`'s tier, and they are
    split into `tier_statements` because a caller that only needs the tenant to be able to
    connect must not send them -- see `shared_statements`.
    """
    return (
        *shared_statements(db_prefix, tenant_id, budget, grants, secret),
        *tier_statements(db_prefix, tenant_id, budget),
    )


def shared_statements(
    db_prefix: str, tenant_id: int, budget: Budget, grants: tuple[str, ...], secret: str
) -> tuple[str, ...]:
    """The tenant's access objects with the tier it is on left alone.

    Everything here is either a create that an existing object already satisfies, or an alter
    that is true whatever tier the tenant sits on: the *profile object* for `budget`'s tier is
    brought up to this file's numbers (a tenant on some other tier has a different profile
    object, which this does not touch), the user exists with today's derived password, and it
    may read what a report reads.

    This is what connecting to an existing tenant runs. Sending the full `statements` there
    would end in `ALTER USER ... SETTINGS PROFILE poker_budget_standard`, which put every tenant
    back on the standard tier the moment it next connected.
    """
    profile, user, quota = (
        profile_name(budget),
        user_name(db_prefix, tenant_id),
        quota_name(db_prefix, tenant_id),
    )
    identified = _identified(secret, user)
    return (
        f"CREATE SETTINGS PROFILE IF NOT EXISTS {profile} SETTINGS {_profile_clause(budget)}",
        f"ALTER SETTINGS PROFILE {profile} SETTINGS {_profile_clause(budget)}",
        f"CREATE USER IF NOT EXISTS {user} {identified}",
        f"ALTER USER {user} {identified}",
        *(f"GRANT SELECT ON {target} TO {user}" for target in grants),
        f"CREATE QUOTA IF NOT EXISTS {quota} KEYED BY user_name "
        f"FOR INTERVAL {QUOTA_INTERVAL} MAX {_quota_clause(budget)} TO {user}",
    )


def tier_statements(db_prefix: str, tenant_id: int, budget: Budget) -> tuple[str, ...]:
    """The two statements that move a tenant onto `budget`'s tier, and only those.

    Separated from `shared_statements` because they are the difference between provisioning a
    tenant and re-tiering one: an `ALTER` here silently overrides whatever tier the tenant was
    put on, so it must be sent when a tier is chosen and never merely because a process
    reconnected. The quota's consumption is not reset by re-stating its ceiling.
    """
    return (
        f"ALTER USER {user_name(db_prefix, tenant_id)} SETTINGS PROFILE {profile_name(budget)}",
        f"ALTER QUOTA {quota_name(db_prefix, tenant_id)} "
        f"FOR INTERVAL {QUOTA_INTERVAL} MAX {_quota_clause(budget)}",
    )


def _identified(secret: str, user: str) -> str:
    """The `IDENTIFIED WITH` clause. Only the hash of the derived password leaves this module."""
    hashed = hashlib.sha256(password(secret, user).encode()).hexdigest()
    return f"IDENTIFIED WITH sha256_hash BY '{hashed}'"


def drop_statements(db_prefix: str, tenant_id: int) -> tuple[str, ...]:
    """Remove one tenant's access objects. The integration suite's teardown; no product path.

    The profile is deliberately left alone: it belongs to the tier, not to the tenant.
    """
    return (
        f"DROP QUOTA IF EXISTS {quota_name(db_prefix, tenant_id)}",
        f"DROP USER IF EXISTS {user_name(db_prefix, tenant_id)}",
    )


def _profile_clause(budget: Budget) -> str:
    """`name = value CONST` for every ceiling, plus read-only."""
    capped = ", ".join(f"{name} = {value} CONST" for name, value in budget.query_settings().items())
    # Not CONST: ClickHouse already refuses to lower `readonly`, and constraining a setting the
    # driver might legitimately send is a failure mode bought for nothing.
    return f"{capped}, readonly = 2"


def _quota_clause(budget: Budget) -> str:
    return ", ".join(f"{name} = {value}" for name, value in budget.hourly_limits().items())


def _checked(name: str) -> str:
    if not NAME.match(name):
        raise ValueError(f"refusing to send {name!r} to ClickHouse as an identifier")
    return name
