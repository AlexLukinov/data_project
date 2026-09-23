"""stored node keys gain line_so_far, size_bucket and pot_type (ADR-078, plan H.1)

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-09-23 12:00:00.000000

`ranges.lookup` is a JSONB equality over the whole key (`api/range_library.py`), and a key is
stored in its canonical form, every field present. Before this revision that was eight
fields; `NodeKey` now has eleven. A key saved with eight would never again equal the eleven a
client sends, and "my chart" would silently vanish from the compare page and the analyzer.
So the three defaults are written into every stored key -- `ranges.node_key` and
`analyses.node_key` -- the key's own values winning wherever it already carries one. The
same statement is what the integration suite runs over a key saved the old way
(`tests/integration/test_node_key_migration.py`).

The rule this sets (ADR-085): a field added to `NodeKey` ships with a data migration that
writes its default into every stored key.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9c0d1e2f3a4"
down_revision: str | None = "a8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_FIELDS: tuple[str, ...] = ("line_so_far", "size_bucket", "pot_type")
DEFAULTS = '{"line_so_far": null, "size_bucket": null, "pot_type": null}'
TABLES: tuple[str, ...] = ("ranges", "analyses")
"""Both tables that store a `NodeKey`. Heuristics read their analysis's key and store none."""


def fill_statement(table: str) -> str:
    """Write the defaults into every key of `table` missing any of them; stored values win."""
    missing = " OR ".join(f"NOT jsonb_exists(node_key, '{field}')" for field in NEW_FIELDS)
    return (
        f"UPDATE {table} SET node_key = '{DEFAULTS}'::jsonb || node_key "
        f"WHERE node_key IS NOT NULL AND ({missing})"
    )


def strip_statement(table: str) -> str:
    """Remove the three fields from every key of `table`: the eight-field shape again."""
    fields = ",".join(NEW_FIELDS)
    return (
        f"UPDATE {table} SET node_key = node_key - '{{{fields}}}'::text[] "
        "WHERE node_key IS NOT NULL"
    )


def upgrade() -> None:
    for table in TABLES:
        op.execute(sa.text(fill_statement(table)))


def downgrade() -> None:
    # Lossy for any key that set one of the three: back up first
    # (`pg_dump -t ranges -t analyses`).
    for table in TABLES:
        op.execute(sa.text(strip_statement(table)))
