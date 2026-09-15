"""Request/response models. **Pydantic lives here and nowhere in the hot path.**

The canonical hand model uses dataclasses because it is constructed millions of times during
a bulk import and per-instance validation would dominate the cost. At the API boundary the
opposite is true: input is untrusted, volume is tiny, and validation is exactly what you
want. Separate request and response models throughout — ORM objects are never returned.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    """New account."""

    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(default="", max_length=120)


class LoginRequest(BaseModel):
    """Credentials."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    """Access token. The refresh token goes out as an HttpOnly cookie, never in the body."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    """Public view of an account. Note: no password hash, no internal ids beyond the UUID."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    is_active: bool


class HandSummary(BaseModel):
    """A row in the hand list."""

    hand_uid: str
    site: str
    played_at_utc: datetime
    stake_level: str
    seat: int
    """Whose row this is: hero's seat in a hero list, the seat that matched in a search. The
    replayer opens on it, so a pool hand needs no hero to be worth listing."""
    position: str
    hole_cards: str
    board: str
    net_won_bb: float
    went_to_showdown: bool
    tags: list[str] = Field(default_factory=list)
    """The user's tags on this hand (plan D.7b) -- attached by the router from Postgres, so a
    row read straight off ClickHouse carries none."""


class HandPlayerOut(BaseModel):
    """One seat in the replayer."""

    seat: int
    screen_name: str
    position: str
    is_hero: bool
    is_anonymized: bool
    starting_stack: float
    hole_cards: str
    net_won: float
    net_won_bb: float
    went_to_showdown: bool
    won_hand: bool


class ActionOut(BaseModel):
    """One action in the replayer, in global order within the hand."""

    action_index: int
    street: str
    seat: int
    action_type: str
    amount: float
    amount_to: float
    pot_before: float
    to_call: float
    is_allin: bool


class HandDetail(BaseModel):
    """Everything the replayer needs for one hand.

    Fully typed: OpenAPI describes every field, and a renamed column fails here instead of
    silently shifting a value.
    """

    hand_uid: str
    site: str
    site_hand_id: str
    played_at_utc: datetime
    game_type: str
    stake_level: str
    big_blind: float
    board: list[str]
    total_pot: float
    rake: float
    players: list[HandPlayerOut]
    actions: list[ActionOut]
