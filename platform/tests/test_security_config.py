"""Startup safety checks and the auth rate limiter, without a stack.

Regressions for docs/POKER_AUDIT.md B8: the placeholder JWT secret used to be accepted in
any environment, the refresh cookie's `Secure` flag was hardcoded off, and login/register had
no rate limit at all.
"""

from __future__ import annotations

import contextlib
import uuid
from dataclasses import dataclass, field

import pytest
from fastapi import HTTPException

from api import cache, ratelimit
from api.deps import CurrentUser
from api.main import refuse_unsafe_config
from core.settings import DEFAULT_JWT_SECRET, Settings


def _settings(**overrides: object) -> Settings:
    """A Settings object built from explicit values, ignoring any local `.env`."""
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


@dataclass(frozen=True)
class _Address:
    host: str


@dataclass(frozen=True)
class _Request:
    """The one attribute `by_address` reads off a Starlette request."""

    host: str

    @property
    def client(self) -> _Address:
        return _Address(self.host)


def test_dev_tolerates_the_placeholder_secret() -> None:
    refuse_unsafe_config(_settings(environment="dev", jwt_secret=DEFAULT_JWT_SECRET))


@pytest.mark.parametrize("environment", ["test", "prod"])
def test_placeholder_secret_is_refused_outside_dev(environment: str) -> None:
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        refuse_unsafe_config(
            _settings(environment=environment, jwt_secret=DEFAULT_JWT_SECRET, cookie_secure=True)
        )


def test_prod_requires_a_secure_cookie() -> None:
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        refuse_unsafe_config(
            _settings(environment="prod", jwt_secret="x" * 40, cookie_secure=False)
        )
    refuse_unsafe_config(_settings(environment="prod", jwt_secret="x" * 40, cookie_secure=True))


@dataclass
class _FakeRedis:
    """Just enough of the Redis API for a fixed-window counter."""

    counts: dict[str, int] = field(default_factory=dict)
    expiries: dict[str, int] = field(default_factory=dict)

    def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def expire(self, key: str, seconds: int) -> None:
        self.expiries[key] = seconds


def test_rate_limit_allows_up_to_the_budget_then_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(cache, "client", lambda: fake)

    allowed = [ratelimit.hit("ratelimit:auth:1.2.3.4", 3) for _ in range(5)]

    assert allowed == [True, True, True, False, False]
    assert fake.expiries["ratelimit:auth:1.2.3.4"] == ratelimit.WINDOW_SECONDS


def test_rate_limit_fails_open_when_redis_is_down(monkeypatch: pytest.MonkeyPatch) -> None:
    """A cache outage must degrade to 'no limit', never to 'nobody can sign in'."""
    import redis

    def _broken() -> None:
        raise redis.ConnectionError("down")

    monkeypatch.setattr(cache, "client", _broken)
    assert ratelimit.hit("ratelimit:auth:x", 1) is True


async def test_refreshing_cannot_spend_the_sign_in_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """Separate buckets per route family (plan E.3): a browser's refreshes are not an attack.

    Sharing one key meant a tab that had been open all day could exhaust the budget whose job is
    to stop credential stuffing, and lock its own user out of signing in again.
    """
    fake = _FakeRedis()
    monkeypatch.setattr(cache, "client", lambda: fake)
    request = _Request("9.9.9.9")
    limit = _settings().auth_rate_limit_per_minute

    for _ in range(limit + 1):
        with contextlib.suppress(HTTPException):
            await ratelimit.refresh_rate_limit(request)  # type: ignore[arg-type]
    await ratelimit.auth_rate_limit(request)  # type: ignore[arg-type]

    assert fake.counts["ratelimit:refresh:9.9.9.9"] == limit + 1
    assert fake.counts["ratelimit:auth:9.9.9.9"] == 1


async def test_the_auth_limit_answers_429_with_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(cache, "client", lambda: fake)
    monkeypatch.setattr(ratelimit, "get_settings", lambda: _settings(auth_rate_limit_per_minute=1))
    request = _Request("5.5.5.5")

    await ratelimit.auth_rate_limit(request)  # type: ignore[arg-type]
    with pytest.raises(HTTPException) as raised:
        await ratelimit.auth_rate_limit(request)  # type: ignore[arg-type]

    assert raised.value.status_code == 429
    assert raised.value.headers == {"Retry-After": str(ratelimit.WINDOW_SECONDS)}


async def test_the_tenant_budget_is_keyed_on_the_tenant_not_the_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One tenant exhausting its budget must not touch another's, on any address."""
    fake = _FakeRedis()
    monkeypatch.setattr(cache, "client", lambda: fake)
    monkeypatch.setattr(ratelimit, "TENANT_REQUESTS_PER_MINUTE", 2)
    one = CurrentUser(id=uuid.uuid4(), tenant_id=11, email="one@example.com")
    two = CurrentUser(id=uuid.uuid4(), tenant_id=12, email="two@example.com")

    await ratelimit.tenant_rate_limit(one)
    await ratelimit.tenant_rate_limit(one)
    with pytest.raises(HTTPException) as raised:
        await ratelimit.tenant_rate_limit(one)
    await ratelimit.tenant_rate_limit(two)

    assert raised.value.status_code == 429
    assert fake.counts == {"ratelimit:tenant:11": 3, "ratelimit:tenant:12": 1}
