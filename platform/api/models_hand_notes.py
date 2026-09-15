"""Hand notes and hand tags (plan D.7b): what a person writes on a hand, kept in Postgres.

The dividing line in `api/models_pg.py` puts these here in as many words -- "a note someone
typed is Postgres". The hand itself stays in ClickHouse and is never touched: a note or a tag
is a row keyed by the hand's `hand_uid` (the 32-character hex every URL and `core.*` use), so
annotating a hand writes nothing into the analysis databases and re-parsing the corpus loses
nothing written on it.

**There is no foreign key to the hand, because the hand is in another database.** Whether the
tenant owns the hand is checked against ClickHouse at the HTTP edge (`api/routers/hands.py`,
`owned_hand`) before a row is written, with the same 404 as `GET /v1/hands/{uid}` -- the answer
must not reveal that a hand exists at all.

One note per hand per user, enforced by the unique constraint; that constraint is also the
`(user_id, hand_uid)` index the reads need. Tags are one row per `(user, hand, tag)`, unique
so that adding a tag twice is a no-op rather than a duplicate, with a second index on
`(user_id, tag)` for the two questions the list asks -- "which hands carry this tag" and
"which tags do I use".
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from api.models_pg import Base, TimestampMixin

HAND_UID_CHARS = 32
"""`hand_uid` as `core.*` and every URL spell it: 16 bytes as lowercase hex."""
MAX_TAG_CHARS = 40


class HandNote(Base, TimestampMixin):
    """The one free-text note a user keeps on one hand."""

    __tablename__ = "hand_notes"
    __table_args__ = (UniqueConstraint("user_id", "hand_uid", name="uq_hand_notes_user_hand"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    hand_uid: Mapped[str] = mapped_column(String(HAND_UID_CHARS), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)


class HandTag(Base, TimestampMixin):
    """One tag on one hand. The tag text is normalized before it gets here (`normalize_tag`)."""

    __tablename__ = "hand_tags"
    __table_args__ = (
        UniqueConstraint("user_id", "hand_uid", "tag", name="uq_hand_tags_user_hand_tag"),
        Index("ix_hand_tags_user_tag", "user_id", "tag"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    hand_uid: Mapped[str] = mapped_column(String(HAND_UID_CHARS), nullable=False)
    tag: Mapped[str] = mapped_column(String(MAX_TAG_CHARS), nullable=False)
