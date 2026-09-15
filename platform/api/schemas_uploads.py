"""Request/response models for uploads, sites and poker accounts (plan D.8, ADR-051).

The upload page reads nothing but these, so every field a poller branches on is a closed set:
`status` is the lifecycle the worker writes (`ingestion/upload_status.py`), `dedupe` says what
a second drop of the same bytes did, and `dataset` is `None` only on a row written before the
column existed.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from parser.registry import supported_sites

UploadStatus = Literal["queued", "processing", "completed", "failed"]
Dedupe = Literal["new", "duplicate", "requeued"]
"""`new` work; a `duplicate` of bytes already uploaded (its status is that upload's); or a
failed upload of the same bytes `requeued` -- the one way a failure is retried."""
DatasetName = Literal["hero", "population"]


class SitesResponse(BaseModel):
    """The networks with a registered parser, by the code a `site` form field takes."""

    sites: list[str]


class UploadAccepted(BaseModel):
    """202 response from the ingestion endpoint."""

    upload_id: uuid.UUID
    status: UploadStatus
    dedupe: Dedupe


class UploadResponse(BaseModel):
    """One upload and how far the worker has got with it."""

    model_config = ConfigDict(from_attributes=True)

    upload_id: uuid.UUID = Field(validation_alias="id")
    status: UploadStatus
    site: str
    dataset: DatasetName | None
    filename: str
    byte_size: int
    hands_found: int
    hands_parsed: int
    hands_failed: int
    hands_without_hero: int
    """Stored hands of a `hero` upload with no seat resolved as the uploader's."""
    error_text: str
    """A sentence for the uploader when `status` is `failed`; never an exception's text."""
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class PokerAccountRequest(BaseModel):
    """Register a screen name: how a seat is recognised as the uploader's in later uploads."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    site: str = Field(max_length=32)
    screen_name: str = Field(min_length=1, max_length=120)

    @field_validator("site")
    @classmethod
    def _supported(cls, site: str) -> str:
        """A site with no parser would store a name no upload can ever match."""
        codes = [s.value for s in supported_sites()]
        if site not in codes:
            raise ValueError(f"unsupported site {site!r} (supported: {', '.join(codes)})")
        return site


class PokerAccountResponse(BaseModel):
    """A registered screen name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site: str
    screen_name: str
    is_verified: bool
