"""heuristics (the heuristic log, plan F.11)

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-09-11 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e6f7a8b9c0d1"
down_revision: str | None = "d5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "heuristics",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("analysis_id", sa.UUID(), nullable=True),
        sa.Column("text", sa.String(length=500), nullable=False),
        sa.Column("street", sa.String(length=16), nullable=False),
        sa.Column("position", sa.String(length=8), nullable=False),
        sa.Column("texture", sa.String(length=32), nullable=False),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # SET NULL, not CASCADE: deleting the analysis must not delete the lesson it taught.
        sa.ForeignKeyConstraint(
            ["analysis_id"],
            ["analyses.id"],
            name=op.f("fk_heuristics_analysis_id_analyses"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_heuristics_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_heuristics")),
    )
    op.create_index(op.f("ix_heuristics_user_id"), "heuristics", ["user_id"], unique=False)
    op.create_index(op.f("ix_heuristics_analysis_id"), "heuristics", ["analysis_id"], unique=False)


def downgrade() -> None:
    # The table holds the founder's own written heuristics, which outlive the analyses they
    # came from: back it up (`pg_dump -t heuristics`) before running this.
    op.drop_index(op.f("ix_heuristics_analysis_id"), table_name="heuristics")
    op.drop_index(op.f("ix_heuristics_user_id"), table_name="heuristics")
    op.drop_table("heuristics")
