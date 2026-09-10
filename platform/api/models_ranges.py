"""The range library (plan F.6, spec §11.1): `ranges` and their append-only `range_versions`.

Same `Base` and conventions as `models_pg.py`; a separate module only for the 300-line file
limit. A range row carries what is browsed and searched -- name, situation (`node_key`, the
ADR-028 `NodeKey` as JSON), source, tags -- and the number of its current version. The weights
live in `range_versions`, one row per save, never updated: a revert is a new version with an
old body, so the history is complete by construction and nothing is ever lost by editing.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from api.models_pg import Base, TimestampMixin

SOURCE_OWN = "own"
FORMAT_COMBO = "combo"
FIRST_VERSION = 1


class StoredRange(Base, TimestampMixin):
    """A named range at one situation. `name` is unique per user; lookup matches `node_key`."""

    __tablename__ = "ranges"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_ranges_user_name"),
        # Lookup is `WHERE user_id = ? AND node_key = ?`: JSONB compares by value, key order
        # ignored, so a btree over the whole document serves the equality directly.
        Index("ix_ranges_user_node_key", "user_id", "node_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    node_key: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default=SOURCE_OWN, nullable=False)
    """own | solver | pool -- the three columns of the comparison view."""
    source_tool: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    format: Mapped[str] = mapped_column(String(16), default=FORMAT_COMBO, nullable=False)
    """The notation the range was written in (`combo` or `class`); the body is always combo text."""
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, default=FIRST_VERSION, nullable=False)


class RangeVersion(Base, TimestampMixin):
    """One saved body of a range: the 1326-entry combo text `poker-core` serializes, plus a note."""

    __tablename__ = "range_versions"
    __table_args__ = (
        UniqueConstraint("range_id", "version", name="uq_range_versions_range_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    range_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("ranges.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    weights: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str] = mapped_column(String(500), default="", nullable=False)
