"""the dataset an upload went to, and its hands with no seat of the uploader's (plan D.8)

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-09-15 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8b9c0d1e2f3"
down_revision: str | None = "f7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable on purpose: no row written before this revision recorded its dataset, and a
    # default of 'hero' would state something false about every pool file already imported.
    # Postgres 11+ adds both columns as metadata only; no existing row is rewritten.
    op.add_column("uploads", sa.Column("dataset", sa.String(length=16), nullable=True))
    op.add_column(
        "uploads",
        sa.Column("hands_without_hero", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    # Both columns are derivable only by re-uploading: back them up
    # (`pg_dump -t uploads`) before running this.
    op.drop_column("uploads", "hands_without_hero")
    op.drop_column("uploads", "dataset")
