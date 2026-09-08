"""PostgreSQL system of record — SQLAlchemy 2.x ORM models.

**The dividing line between Postgres and ClickHouse**, since it comes up constantly: if a
human edits it, it lives here. If it is derived from hands, it lives in ClickHouse. A note
someone typed is Postgres. VPIP is arithmetic over hands, so it is ClickHouse. When unsure,
ask "would I ever UPDATE a single row of this?" -- ClickHouse hates that question and
Postgres was built for it.

Conventions (from the project's global standards): UUID primary keys, `{table}_id` foreign
keys, `is_`/`has_` boolean prefixes, `created_at`/`updated_at` on every table, every foreign
key explicitly indexed (Postgres does NOT do it for you), and a `MetaData` naming convention
from day one so Alembic generates stable constraint names forever.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Set once, at the start. Without it Alembic invents constraint names that differ between
# environments, and every future ALTER has to guess what the constraint is called.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base carrying the naming convention."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    """`created_at` / `updated_at` on every table, maintained by the database."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(Base, TimestampMixin):
    """A platform account. `tenant_id` is the ClickHouse-side numeric tenant key.

    Why both a UUID and an integer: UUIDs are the right primary key for a public API (no
    enumeration, no coordination), but ClickHouse sort keys want a compact fixed-width value
    and a UInt32 is four bytes against a UUID's sixteen -- multiplied by every row of the
    largest tables in the system.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[int] = mapped_column(
        # Postgres IDENTITY on a non-primary-key column: `autoincrement=True` only applies to
        # primary keys, and silently does nothing here.
        Integer,
        Identity(always=False, start=1),
        unique=True,
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)

    poker_accounts: Mapped[list[PokerAccount]] = relationship(
        back_populates="user", lazy="raise", cascade="all, delete-orphan"
    )
    uploads: Mapped[list[Upload]] = relationship(
        back_populates="user", lazy="raise", cascade="all, delete-orphan"
    )


class RefreshToken(Base, TimestampMixin):
    """Server-side record of an issued refresh token. Stored hashed, never in plaintext."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PokerAccount(Base, TimestampMixin):
    """A screen name the user plays under on one site.

    **This table is how `is_hero` gets resolved.** Without it the parser can only guess from
    the `Dealt to` line, which fails on observed hands and on formats that don't print it.
    """

    __tablename__ = "poker_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "site", "screen_name", name="uq_poker_account_identity"),
        Index("ix_poker_accounts_user_site", "user_id", "site"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    site: Mapped[str] = mapped_column(String(32), nullable=False)
    screen_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped[User] = relationship(back_populates="poker_accounts", lazy="raise")


class Upload(Base, TimestampMixin):
    """One uploaded hand-history file and the state of its processing.

    Doubles as the first observability tool: `GROUP BY status, site` over the last 24 hours
    answers most operational questions before any dashboard exists.
    """

    __tablename__ = "uploads"
    __table_args__ = (
        # Re-uploading the same bytes is a no-op rather than a duplicate import. This one
        # constraint removes an entire class of support ticket.
        UniqueConstraint("user_id", "sha256", name="uq_uploads_user_sha256"),
        Index("ix_uploads_user_created", "user_id", "created_at"),
        Index("ix_uploads_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    site: Mapped[str] = mapped_column(String(32), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="queued", nullable=False)
    """queued -> processing -> completed | failed"""
    hands_found: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    hands_parsed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    hands_failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="uploads", lazy="raise")


class BaselineSet(Base, TimestampMixin):
    """Metadata for one set of baseline strategies. **Seam — created empty in Phase 1.**

    The payload lives in ClickHouse (`marts.baseline_strategies`, keyed by `spot_key`); only
    the provenance lives here. Sources, in the order they will actually arrive:
      1. `population` -- derived from our own hands. Needs no solver. Ships in Phase 2.
      2. `purchased`  -- third-party solver output.
      3. `solver`     -- our own queued TexasSolver runs. Future.

    See docs/POKER_DECISIONS.md ADR-011.
    """

    __tablename__ = "baseline_sets"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    game_type: Mapped[str] = mapped_column(String(32), nullable=False)
    stake_bucket: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    solver_version: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    coverage: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
