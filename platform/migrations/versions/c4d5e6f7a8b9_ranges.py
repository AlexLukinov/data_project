"""ranges and range versions (the range library, plan F.6)

Revision ID: c4d5e6f7a8b9
Revises: 8b2f4c6d1e3a
Create Date: 2026-09-10 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "8b2f4c6d1e3a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ranges",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("node_key", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("source_tool", sa.String(length=120), nullable=False),
        sa.Column("format", sa.String(length=16), nullable=False),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_ranges_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ranges")),
        sa.UniqueConstraint("user_id", "name", name="uq_ranges_user_name"),
    )
    op.create_index(op.f("ix_ranges_user_id"), "ranges", ["user_id"], unique=False)
    op.create_index("ix_ranges_user_node_key", "ranges", ["user_id", "node_key"], unique=False)
    op.create_table(
        "range_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("range_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("weights", sa.Text(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["range_id"],
            ["ranges.id"],
            name=op.f("fk_range_versions_range_id_ranges"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_range_versions")),
        sa.UniqueConstraint("range_id", "version", name="uq_range_versions_range_version"),
    )
    op.create_index(
        op.f("ix_range_versions_range_id"), "range_versions", ["range_id"], unique=False
    )


def downgrade() -> None:
    # Both tables hold user-authored charts: back up `ranges` and `range_versions`
    # (`pg_dump -t ranges -t range_versions`) before running this.
    op.drop_index(op.f("ix_range_versions_range_id"), table_name="range_versions")
    op.drop_table("range_versions")
    op.drop_index("ix_ranges_user_node_key", table_name="ranges")
    op.drop_index(op.f("ix_ranges_user_id"), table_name="ranges")
    op.drop_table("ranges")
