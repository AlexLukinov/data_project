"""Password hashing and JWT issuing/verification.

Two deliberate choices worth knowing:

* **Argon2id, not bcrypt.** It is the current password-hashing competition winner and is
  memory-hard, which is what defeats GPU cracking. `argon2-cffi` picks sane parameters.
* **Short-lived access token + HttpOnly refresh cookie.** The access token (30 min) is
  JS-reachable and therefore XSS-exposed, so it must expire fast. The refresh token lives in
  an HttpOnly cookie that JavaScript cannot read at all, and is additionally stored hashed
  server-side so it can be revoked.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from core.settings import get_settings

_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    """Hash a password for storage."""
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Check a password against its stored hash."""
    try:
        return _hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def create_access_token(*, user_id: uuid.UUID, tenant_id: int) -> str:
    """Issue a short-lived access token.

    **`tenant_id` is embedded in the token and is the ONLY source of tenancy.** No endpoint
    accepts a tenant identifier from the client. See docs/POKER_DECISIONS.md ADR-009.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "tid": tenant_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and verify an access token. Raises `jwt.PyJWTError` when invalid."""
    settings = get_settings()
    claims: dict[str, Any] = jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
    if claims.get("typ") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return claims


def new_refresh_token() -> tuple[str, str]:
    """Return (plaintext, sha256) for a fresh refresh token.

    The plaintext goes to the client in an HttpOnly cookie; only the hash is stored, so a
    database leak does not hand out live sessions.
    """
    plain = secrets.token_urlsafe(48)
    return plain, hashlib.sha256(plain.encode()).hexdigest()


def hash_refresh_token(plain: str) -> str:
    """Hash a refresh token for lookup."""
    return hashlib.sha256(plain.encode()).hexdigest()
