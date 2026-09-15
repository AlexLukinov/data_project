"""Registration, login, refresh, and poker-account management (list, add, remove -- plan D.8)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from api.deps import CurrentUserDep, SessionDep
from api.models_pg import PokerAccount, RefreshToken, User
from api.ratelimit import auth_rate_limit, refresh_rate_limit
from api.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from api.schemas_uploads import PokerAccountRequest, PokerAccountResponse
from api.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    verify_password,
)
from core.settings import get_settings

router = APIRouter(prefix="/v1/auth", tags=["auth"])

REFRESH_COOKIE = "poker_refresh"


async def _issue(response: Response, session: SessionDep, user: User) -> TokenResponse:
    """Mint an access token and set the refresh cookie."""
    settings = get_settings()
    plain, hashed = new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hashed,
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
        )
    )
    await session.commit()

    response.set_cookie(
        REFRESH_COOKIE,
        plain,
        max_age=settings.refresh_token_days * 86400,
        httponly=True,  # JavaScript cannot read it; that is the entire point
        samesite="lax",
        secure=settings.cookie_secure,  # false only for plain-http dev; enforced in api.main
        path="/v1/auth",
    )
    return TokenResponse(
        access_token=create_access_token(user_id=user.id, tenant_id=user.tenant_id),
        expires_in=settings.access_token_minutes * 60,
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth_rate_limit)],
)
async def register(body: RegisterRequest, response: Response, session: SessionDep) -> TokenResponse:
    """Create an account and sign in."""
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        display_name=body.display_name,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered") from exc
    await session.refresh(user)
    return await _issue(response, session, user)


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(auth_rate_limit)])
async def login(body: LoginRequest, response: Response, session: SessionDep) -> TokenResponse:
    """Exchange credentials for tokens."""
    result = await session.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()
    # One generic message for "no such user" and "wrong password": distinguishing them turns
    # the login endpoint into an account-enumeration oracle.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    return await _issue(response, session, user)


@router.post("/refresh", response_model=TokenResponse, dependencies=[Depends(refresh_rate_limit)])
async def refresh(
    response: Response,
    session: SessionDep,
    poker_refresh: str | None = Cookie(default=None),
) -> TokenResponse:
    """Rotate the refresh token and mint a new access token."""
    if not poker_refresh:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(poker_refresh))
    )
    token = result.scalar_one_or_none()
    now = datetime.now(UTC)
    if token is None or token.revoked_at is not None or token.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token invalid")

    # Rotate: the presented token is revoked as it is exchanged, so replaying a stolen one
    # fails and the theft is detectable.
    token.revoked_at = now
    user = (await session.execute(select(User).where(User.id == token.user_id))).scalar_one()
    return await _issue(response, session, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: SessionDep,
    poker_refresh: str | None = Cookie(default=None),
) -> None:
    """Revoke the refresh token and clear the cookie."""
    if poker_refresh:
        result = await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(poker_refresh))
        )
        token = result.scalar_one_or_none()
        if token is not None:
            token.revoked_at = datetime.now(UTC)
            await session.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/v1/auth")


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUserDep, session: SessionDep) -> User:
    """The authenticated account."""
    return (await session.execute(select(User).where(User.id == user.id))).scalar_one()


@router.get("/poker-accounts", response_model=list[PokerAccountResponse])
async def list_poker_accounts(user: CurrentUserDep, session: SessionDep) -> list[PokerAccount]:
    """Screen names registered by this user."""
    result = await session.execute(
        select(PokerAccount)
        .where(PokerAccount.user_id == user.id)
        .order_by(PokerAccount.site, PokerAccount.screen_name)
    )
    return list(result.scalars().all())


def _taken(body: PokerAccountRequest) -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        f"{body.screen_name!r} is already one of your {body.site} screen names.",
    )


@router.post(
    "/poker-accounts",
    response_model=PokerAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_poker_account(
    body: PokerAccountRequest, user: CurrentUserDep, session: SessionDep
) -> PokerAccount:
    """Register a screen name so the seat it sits in is recognised as this user's.

    Compared without case, because the parser compares without case (`hero_names` are lowered
    before matching): `Hero` and `hero` would be two rows naming one seat.
    """
    same = await session.execute(
        select(PokerAccount.id).where(
            PokerAccount.user_id == user.id,
            PokerAccount.site == body.site,
            func.lower(PokerAccount.screen_name) == body.screen_name.lower(),
        )
    )
    if same.first() is not None:
        raise _taken(body)
    account = PokerAccount(user_id=user.id, site=body.site, screen_name=body.screen_name)
    session.add(account)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _taken(body) from exc
    await session.refresh(account)
    return account


@router.delete("/poker-accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_poker_account(
    account_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> None:
    """Forget a screen name. Hands already uploaded keep the seat they were given.

    Scoped by `user_id` in the WHERE clause: another user's account id is a 404, the same
    answer as an id that never existed.
    """
    result = await session.execute(
        delete(PokerAccount)
        .where(PokerAccount.id == account_id, PokerAccount.user_id == user.id)
        .returning(PokerAccount.id)
    )
    if result.first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Poker account not found")
    await session.commit()
