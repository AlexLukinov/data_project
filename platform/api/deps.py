"""FastAPI dependencies: authentication and tenancy.

**`CurrentUser` is the only source of `tenant_id` in the entire application.** No endpoint
takes it as a path, query or body parameter. That is enforced by construction — `ReportRequest`
has no tenant field and `stats.query.build_query` takes the tenant as its own argument, so a
query without one cannot be built at all — and by `tests/test_tenant_isolation.py`, which
actively tries to break it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_session
from api.models_pg import PokerAccount, User
from api.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CurrentUser:
    """The authenticated principal. `tenant_id` scopes every analytics query."""

    id: uuid.UUID
    tenant_id: int
    email: str


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CurrentUser:
    """Resolve the caller from the bearer token, or 401."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = decode_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        # Deliberately generic: never leak whether the token was expired, malformed or
        # signed with the wrong key.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user_id = uuid.UUID(claims["sub"])
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account unavailable")

    # tenant_id is re-read from the database rather than trusted from the token, so revoking
    # or reassigning it takes effect immediately instead of at token expiry.
    return CurrentUser(id=user.id, tenant_id=user.tenant_id, email=user.email)


CurrentUserDep = Annotated[CurrentUser, Depends(current_user)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def hero_names_for(session: AsyncSession, user_id: uuid.UUID, site: str) -> list[str]:
    """The user's registered screen names on one site.

    Handed to the parser so it can resolve which seat is hero. Without it the parser falls
    back to the `Dealt to` line, which fails on observed hands and on formats that omit it.
    """
    result = await session.execute(
        select(PokerAccount.screen_name).where(
            PokerAccount.user_id == user_id, PokerAccount.site == site
        )
    )
    return [row[0] for row in result.all()]
