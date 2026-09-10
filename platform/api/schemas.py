"""Request/response models. **Pydantic lives here and nowhere in the hot path.**

The canonical hand model uses dataclasses because it is constructed millions of times during
a bulk import and per-instance validation would dominate the cost. At the API boundary the
opposite is true: input is untrusted, volume is tiny, and validation is exactly what you
want. Separate request and response models throughout — ORM objects are never returned.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

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


class PokerAccountRequest(BaseModel):
    """Register a screen name. This is how `is_hero` gets resolved during parsing."""

    site: str = Field(max_length=32)
    screen_name: str = Field(min_length=1, max_length=120)


class PokerAccountResponse(BaseModel):
    """A registered screen name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site: str
    screen_name: str
    is_verified: bool


class UploadResponse(BaseModel):
    """Accepted upload. `dedupe` tells the client whether this was new work."""

    model_config = ConfigDict(from_attributes=True)

    upload_id: uuid.UUID = Field(validation_alias="id")
    status: str
    site: str
    filename: str
    hands_found: int
    hands_parsed: int
    hands_failed: int
    error_text: str
    created_at: datetime
    completed_at: datetime | None


class UploadAccepted(BaseModel):
    """202 response from the ingestion endpoint."""

    upload_id: uuid.UUID
    status: str
    dedupe: str
    """`new` or `duplicate` — re-uploading the same bytes is a no-op, not an error."""


class StatValue(BaseModel):
    """One statistic, always accompanied by its sample size.

    **The sample size is not optional.** A 3-bet% over 40 opportunities is noise, and
    rendering it as a bare number is the product misleading its user.
    """

    code: str
    label: str
    value: float | None
    sample: int


class CustomStatSpec(BaseModel):
    """One user-defined statistic.

    `denominator` is the OPPORTUNITY — the field that makes this feature worth having. Both
    counters are validated server-side against an allowlist; this model only shapes the JSON.
    """

    code: str = Field(min_length=1, max_length=40, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(default="", max_length=80)
    numerator: str = Field(min_length=1, max_length=64)
    denominator: str = Field(min_length=1, max_length=64)
    kind: Literal["ratio", "money", "count"] = "ratio"


class CustomStatsRequest(BaseModel):
    """A custom report definition: filters, grouping, and user-defined stats."""

    date_from: date | None = None
    date_to: date | None = None
    dataset: Literal["hero", "population"] = "hero"
    """Which body of hands: own play (`hero`, own seat only) or the observed pool
    (`population`, every seat). Not a filter -- a report never spans both."""
    filters: dict[str, list[str | int]] | None = None
    """Dimension name -> allowed values. Integer dimensions (`is_ip`, `players_to_flop`, ...)
    accept numbers or numeric strings; the server casts to the column's type."""
    group_by: list[str] = Field(default_factory=list, max_length=4)
    stats: list[str] = Field(default_factory=list, max_length=40)
    custom: list[CustomStatSpec] = Field(default_factory=list, max_length=25)


class StatsResponse(BaseModel):
    """A stats query result, one row per group."""

    hands: int
    groups: list[dict[str, object]]
    stats: list[StatValue]
    cached: bool = False


class TimelinePoint(BaseModel):
    """One day on the winnings graph."""

    day: date
    hands: int
    cumulative_bb: float
    cumulative_ev_bb: float
    cumulative_showdown_bb: float
    cumulative_nonshowdown_bb: float


class TimelineResponse(BaseModel):
    """The winnings + EV-adjusted series."""

    points: list[TimelinePoint]
    total_hands: int
    bb_per_100: float | None
    ev_bb_per_100: float | None


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
