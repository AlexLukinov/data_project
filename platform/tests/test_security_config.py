"""Startup safety checks and the auth rate limiter, without a stack.

Regressions for docs/POKER_AUDIT.md B8: the placeholder JWT secret used to be accepted in
any environment, the refresh cookie's `Secure` flag was hardcoded off, and login/register had
no rate limit at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from api import cache, ratelimit
from api.main import refuse_unsafe_config
from api.settings import DEFAULT_JWT_SECRET, Settings


def _settings(**overrides: object) -> Settings:
    """A Settings object built from explicit values, ignoring any local `.env`."""
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


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
