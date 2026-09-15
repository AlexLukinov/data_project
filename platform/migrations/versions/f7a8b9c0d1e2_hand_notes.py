"""hand notes and hand tags (plan D.7b)

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-09-14 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f7a8b9c0d1e2"
down_revision: str | None = "e6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hand_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("hand_uid", sa.String(length=32), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
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
            ["user_id"], ["users.id"], name=op.f("fk_hand_notes_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hand_notes")),
        # One note per hand per user; the unique index is also the (user_id, hand_uid) read path.
        sa.UniqueConstraint("user_id", "hand_uid", name="uq_hand_notes_user_hand"),
    )
    op.create_table(
        "hand_tags",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("hand_uid", sa.String(length=32), nullable=False),
        sa.Column("tag", sa.String(length=40), nullable=False),
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
            ["user_id"], ["users.id"], name=op.f("fk_hand_tags_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hand_tags")),
        # Adding a tag twice is a no-op, not a duplicate row; leads with (user_id, hand_uid).
        sa.UniqueConstraint("user_id", "hand_uid", "tag", name="uq_hand_tags_user_hand_tag"),
    )
    # "Which hands carry this tag" (the list filter) and "which tags do I use" (the vocabulary).
    op.create_index("ix_hand_tags_user_tag", "hand_tags", ["user_id", "tag"], unique=False)


def downgrade() -> None:
    # Both tables hold text the founder typed by hand and nothing derivable from the hands:
    # back them up (`pg_dump -t hand_notes -t hand_tags`) before running this.
    op.drop_index("ix_hand_tags_user_tag", table_name="hand_tags")
    op.drop_table("hand_tags")
    op.drop_table("hand_notes")
