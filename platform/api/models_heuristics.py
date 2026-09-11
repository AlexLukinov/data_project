"""The heuristic log (plan F.11, spec §16): the lessons the analyzer produced, kept.

One row per heuristic -- the one line a spot was worth, tagged by the street, position and
texture it applies to, so the log can be read back as "what have I decided about turn play on
paired boards?" rather than as a diary. `status` plus `confirmed_at` carry the review prompt:
fourteen days after it was written, or after it was last answered, the log asks whether it is
still true, and answering it resets the clock.

**`analysis_id` is nullable on purpose, and the foreign key is `SET NULL`, not `CASCADE`.** A
heuristic is usually step 9's takeaway and points back at the analysis that produced it, but it
can also be written straight into the log with no analysis behind it -- and deleting an analysis
must never delete the lesson learned from it, which outlives the hand it came from.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from api.models_pg import Base, TimestampMixin

MAX_TEXT = 500
MAX_STREET = 16
MAX_POSITION = 8
MAX_TEXTURE = 32
MAX_STATUS = 16
STATUS_OPEN = "open"


class Heuristic(Base, TimestampMixin):
    """One written lesson, with the situation it applies to and the state of its review."""

    __tablename__ = "heuristics"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    analysis_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    """The analysis whose step 9 produced this, if there was one. See the module docstring."""
    text: Mapped[str] = mapped_column(String(MAX_TEXT), nullable=False)
    """The heuristic itself: the sentence that is meant to change a future decision."""
    street: Mapped[str] = mapped_column(String(MAX_STREET), default="", nullable=False)
    """preflop | flop | turn | river, or empty when it applies to every street."""
    position: Mapped[str] = mapped_column(String(MAX_POSITION), default="", nullable=False)
    texture: Mapped[str] = mapped_column(String(MAX_TEXTURE), default="", nullable=False)
    """A board-texture tag from the flop dimensions (`paired`, `monotone`, ...); may be empty."""
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(MAX_STATUS), default=STATUS_OPEN, nullable=False)
    """open | confirmed | retired -- the last answer to "still true?"."""
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """When the review was last answered; `created_at` stands in until it has been."""
