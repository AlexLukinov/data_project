"""The storage schema is declared once (core/schema) and everything derives from it."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

from core.enums import Site
from core.ids import uid_bytes
from core.schema import ACTIONS, HANDS, PLAYERS, TABLES, WINNERS, RowContext
from core.schema.staging import render_staging_model
from ingestion.loader import to_rows
from parser.registry import parse_file
from scripts.gen_schema import expected_files


def _hands(text: str) -> list:
    return list(parse_file(text, Site.POKERSTARS, frozenset({"hero"})))


def test_every_table_has_dataset_second_after_user_id() -> None:
    """Tenant then dataset lead every table, so both prune before anything else."""
    for spec in TABLES:
        assert spec.column_names[:2] == ["user_id", "dataset"], spec.name


def test_column_names_are_unique_per_table() -> None:
    for spec in TABLES:
        assert len(set(spec.column_names)) == len(spec.column_names), spec.name


def test_rows_match_their_specs(stars_edge_text: str) -> None:
    """Every getter runs on the pathological corpus and every row has one value per column."""
    hands = _hands(stars_edge_text)
    for spec, rows in zip(TABLES, to_rows(hands, tenant_id=9, dataset="hero"), strict=True):
        assert rows, spec.name
        for row in rows:
            assert len(row) == len(spec.columns), spec.name


def test_getters_fill_the_once_orphaned_columns(stars_cash_text: str) -> None:
    """players_remaining, entrants, finish_position, cards_revealed and dataset on actions
    and pot winners exist in ClickHouse and were never written before core/schema (AUDIT B11)."""
    hand = _hands(stars_cash_text)[0]
    ctx = RowContext(hand, tenant_id=1, dataset="population", parsed_at=datetime.now(UTC))
    hand_row = dict(zip(HANDS.column_names, HANDS.row(ctx), strict=True))
    assert hand_row["players_remaining"] is None and hand_row["entrants"] is None
    assert hand_row["dataset"] == "population"
    action_ctx = replace(ctx, action=hand.actions[0])
    action_row = dict(zip(ACTIONS.column_names, ACTIONS.row(action_ctx), strict=True))
    assert action_row["dataset"] == "population" and action_row["cards_revealed"] == ""
    player_ctx = replace(ctx, player=hand.players[0])
    player_row = dict(zip(PLAYERS.column_names, PLAYERS.row(player_ctx), strict=True))
    assert player_row["finish_position"] is None


def test_bb_denominated_columns_are_quantized(stars_cash_text: str) -> None:
    hand = _hands(stars_cash_text)[0]
    ctx = RowContext(
        hand, tenant_id=1, dataset="hero", parsed_at=datetime.now(UTC), player=hand.players[0]
    )
    row = dict(zip(PLAYERS.column_names, PLAYERS.row(ctx), strict=True))
    assert isinstance(row["starting_stack_bb"], Decimal)
    assert row["starting_stack_bb"] == row["starting_stack_bb"].quantize(Decimal("0.01"))
    assert row["net_won_bb"] == row["net_won_bb"].quantize(Decimal("0.0001"))


def test_winner_rows_carry_the_hand_provenance(stars_edge_text: str) -> None:
    hands = _hands(stars_edge_text)
    _, _, _, winners = to_rows(hands, tenant_id=4)
    uid_at = WINNERS.column_names.index("hand_uid")
    assert {w[uid_at] for w in winners} <= {uid_bytes(h.hand_uid) for h in hands}


def test_every_table_writes_hand_uid_as_sixteen_raw_bytes(stars_edge_text: str) -> None:
    """The write half of the B.5b boundary: the model carries hex, `core.*` takes the bytes.

    Asserted on all four tables at once because the column is declared once
    (`core.schema.base.hand_uid_column`) and a regression would be silent -- ClickHouse takes
    a 32-character hex string into a `FixedString(16)` by refusing it, but a Python `str` of
    16 characters would be accepted and would be the wrong hand.
    """
    hands = _hands(stars_edge_text)
    rows_per_table = to_rows(hands, tenant_id=4)
    expected = {uid_bytes(h.hand_uid) for h in hands}
    for spec, rows in zip(TABLES, rows_per_table, strict=True):
        assert spec.types()["hand_uid"] == "FixedString(16)", spec.name
        uid_at = spec.column_names.index("hand_uid")
        written = {row[uid_at] for row in rows}
        assert written, spec.name
        assert all(isinstance(uid, bytes) and len(uid) == 16 for uid in written), spec.name
        assert written <= expected, spec.name


def test_generated_staging_models_are_current() -> None:
    """`make gen` output is committed; a spec change without regeneration fails here and in CI."""
    for path, content in expected_files().items():
        assert path.exists(), f"{path.name} missing -- run `make gen`"
        assert path.read_text() == content, f"{path.name} is stale -- run `make gen`"


def test_staging_render_projects_every_column_and_extra() -> None:
    sql = render_staging_model(ACTIONS, "actions")
    assert "toString(street) as street" in sql
    assert "toString(action_type) as action_type" in sql
    assert "as is_decision" in sql and "parsed_at as src_parsed_at" in sql
    assert sql.rstrip().endswith("from {{ source('core', 'actions') }} final")
