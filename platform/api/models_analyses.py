"""The saved analyses of the 9-step analyzer (plan F.9, spec §15).

One row per analysis. The nine steps are one JSONB document rather than nine rows: they are
always read and written together, they are never queried across, and the shape is the client's
`AnalysisStep` model, which is validated on the way in and out. `heuristic` is a column of its
own because it outlives the analysis -- F.11's heuristic log is a query over this column.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from api.models_pg import Base, TimestampMixin

FIRST_STEP = 1


class Analysis(Base, TimestampMixin):
    """A hand or a situation worked through the nine steps."""

    __tablename__ = "analyses"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    """stored | pasted | manual -- where the hand came from."""
    hand_uid: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    hand_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    """The pasted history, kept so the analysis reopens; empty for a stored or made-up hand."""
    node_key: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    action_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    """Which step of the hand the analysis is anchored at, so reopening lands on the same node."""
    current_step: Mapped[int] = mapped_column(Integer, default=FIRST_STEP, nullable=False)
    steps: Mapped[list[dict[str, object]]] = mapped_column(JSONB, default=list, nullable=False)
    heuristic: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    """Step 9's takeaway: the one line the whole analysis was for."""
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
