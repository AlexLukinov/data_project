"""The storage schema of the canonical model, declared once.

A `TableSpec` names every column of one `core.*` table with its ClickHouse type and the
function that fills it from a canonical hand. Everything else derives from it:

- `ingestion.loader` builds rows by iterating the spec (no hand-written column lists);
- `core.schema.staging` renders the dbt staging models from it (`make gen`);
- `tests/integration/test_schema_matches_clickhouse.py` compares it with `system.columns`,
  so a migration and the spec cannot silently disagree (docs/POKER_AUDIT.md B11: the schema
  was spelled out in seven places and three columns were never written).

The migrations remain the DDL of record (append-only, ADR-017); the spec is what they must
add up to.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from core.ids import uid_bytes
from core.models import Action, CanonicalHand, HandPlayer, PotWinner

ONE = Decimal(1)

UID = "FixedString(16)"
"""How `core.*` stores `hand_uid`: the 16 raw bytes of the digest, not its 32 hex characters.

The hex form was 51% of the v1 fact table and does not compress -- it is random. Because the
column leads every core sort key, changing it was a table rebuild rather than a migration
(plan B.5b, [ADR-017](../../docs/POKER_DECISIONS.md)).
"""


@dataclass(slots=True, frozen=True)
class RowContext:
    """Everything a column getter may read.

    The hand, the current sub-record (seat, action or pot winner), and the per-import values
    that are NOT properties of the hand text: tenant, dataset, timestamp.
    """

    hand: CanonicalHand
    tenant_id: int
    dataset: str
    parsed_at: datetime
    player: HandPlayer | None = None
    action: Action | None = None
    winner: PotWinner | None = None

    @property
    def bb(self) -> Decimal:
        """Big blind, never zero, for bb-denominated columns."""
        return self.hand.big_blind or ONE

    def require_player(self) -> HandPlayer:
        """The current seat; a programming error if a hand-level getter asked for it."""
        if self.player is None:
            raise ValueError("column getter needs a player context")
        return self.player

    def require_action(self) -> Action:
        """The current action."""
        if self.action is None:
            raise ValueError("column getter needs an action context")
        return self.action

    def require_winner(self) -> PotWinner:
        """The current pot winner."""
        if self.winner is None:
            raise ValueError("column getter needs a pot-winner context")
        return self.winner


Getter = Callable[[RowContext], object]


@dataclass(slots=True, frozen=True)
class ColumnSpec:
    """One column: name, ClickHouse type as `system.columns` reports it, and its getter.

    `staging_expr` overrides the projection in the generated staging model (e.g.
    `toString(street)` for an Enum8).
    """

    name: str
    ch_type: str
    getter: Getter
    staging_expr: str | None = None


def hand_uid_column() -> ColumnSpec:
    """The `hand_uid` column, byte-identical on all four core tables.

    Declared once rather than four times: the canonical model carries hex (`core.ids`) and
    ClickHouse stores the bytes, and four copies of that rule is exactly the drift this
    module exists to remove (docs/POKER_AUDIT.md B11).
    """
    return ColumnSpec("hand_uid", UID, lambda c: uid_bytes(c.hand.hand_uid))


@dataclass(slots=True, frozen=True)
class TableSpec:
    """One `core.*` table."""

    name: str
    columns: tuple[ColumnSpec, ...]
    doc: str = ""
    staging_extras: tuple[str, ...] = field(default_factory=tuple)
    """Derived expressions appended to the generated staging model, e.g. `played_date`."""

    @property
    def column_names(self) -> list[str]:
        """Column names in spec order (the `column_names` argument of an insert)."""
        return [c.name for c in self.columns]

    def row(self, ctx: RowContext) -> list[object]:
        """One row in spec order."""
        return [c.getter(ctx) for c in self.columns]

    def types(self) -> dict[str, str]:
        """Name -> ClickHouse type, for comparison with `system.columns`."""
        return {c.name: c.ch_type for c in self.columns}
