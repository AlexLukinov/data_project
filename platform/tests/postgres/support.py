"""What the Postgres-only hand-annotation suites share: the app, two hand ids, and a fake owner.

Ownership of a hand is decided against ClickHouse by `api.routers.hands.owned_hand`; here
`OWNED` stands in for `core.hands`, and `conftest.py` overrides the dependency with
`fake_owned_hand` for every test in this directory.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from httpx import ASGITransport, AsyncClient

from api.deps import CurrentUserDep
from api.main import app

TRANSPORT = ASGITransport(app=app)
HAND = "0f" * 16
OTHER_HAND = "1e" * 16
PASSWORD = "a-long-enough-password"

OWNED: dict[uuid.UUID, set[str]] = {}
"""Which hands each user owns, standing in for `core.hands` in ClickHouse."""


async def fake_owned_hand(hand_uid: str, user: CurrentUserDep) -> str:
    """The override: 404 unless `OWNED` says this user has this hand."""
    if hand_uid not in OWNED.get(user.id, set()):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hand not found")
    return hand_uid


def auth(token: str) -> dict[str, str]:
    """The bearer header."""
    return {"Authorization": f"Bearer {token}"}


async def new_user(client: AsyncClient, *hands: str) -> tuple[str, uuid.UUID]:
    """Register a throwaway account that owns the given hands; (token, user id)."""
    email = f"notes-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": PASSWORD, "display_name": "n"},
    )
    assert res.status_code == 201, res.text
    token = str(res.json()["access_token"])
    me = (await client.get("/v1/auth/me", headers=auth(token))).json()
    user_id = uuid.UUID(me["id"])
    OWNED[user_id] = set(hands)
    return token, user_id
