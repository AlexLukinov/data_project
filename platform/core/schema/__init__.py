"""The `core.*` storage schema, declared once. See `core/schema/base.py`."""

from __future__ import annotations

from core.schema.actions import ACTIONS
from core.schema.base import ColumnSpec, RowContext, TableSpec
from core.schema.hands import HANDS
from core.schema.players import PLAYERS
from core.schema.winners import WINNERS

TABLES: tuple[TableSpec, ...] = (HANDS, PLAYERS, ACTIONS, WINNERS)
"""Every core table the loader writes, in insert order."""

STAGING_MODULES: dict[str, str] = {
    HANDS.name: "hands",
    PLAYERS.name: "players",
    ACTIONS.name: "actions",
    WINNERS.name: "winners",
}
"""Spec module per table, named in the generated staging model's header."""

__all__ = [
    "ACTIONS",
    "HANDS",
    "PLAYERS",
    "STAGING_MODULES",
    "TABLES",
    "WINNERS",
    "ColumnSpec",
    "RowContext",
    "TableSpec",
]
