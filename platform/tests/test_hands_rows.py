"""Hand endpoints map rows by column NAME. A reordered SELECT cannot shift a value."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from api.hand_query import action_from_row, detail_from_rows, summary_from_row

HAND = {
    "hand_uid": "abc",
    "site": "pokerstars",
    "site_hand_id": "1",
    "played_at_utc": datetime(2026, 8, 18, 16, 46, 10, tzinfo=UTC),
    "game_type": "holdem",
    "stake_level": "NL50",
    "big_blind": Decimal("0.50"),
    "board_flop_1": "Ah",
    "board_flop_2": "Td",
    "board_flop_3": "7c",
    "board_turn": "",
    "board_river": "",
    "total_pot": Decimal("12.5"),
    "rake": Decimal("0.5"),
}


def test_detail_reads_every_field_by_name() -> None:
    player = {
        "seat": 1,
        "screen_name": "Hero",
        "position": "BTN",
        "is_hero": 1,
        "is_anonymized": 0,
        "starting_stack": Decimal("50"),
        "hole_cards": "As Kd",
        "net_won": Decimal("12"),
        "net_won_bb": Decimal("24"),
        "went_to_showdown": 0,
        "won_hand": 1,
    }
    action = {
        "action_index": 3,
        "street": "flop",
        "seat": 1,
        "action_type": "bet",
        "amount": Decimal("4"),
        "amount_to": Decimal("0"),
        "pot_before": Decimal("6"),
        "to_call": Decimal("0"),
        "is_allin": 0,
    }
    detail = detail_from_rows(HAND, [player], [action])
    assert detail.board == ["Ah", "Td", "7c"]
    assert detail.players[0].is_hero is True and detail.players[0].won_hand is True
    assert detail.players[0].starting_stack == 50.0
    assert detail.actions[0].street == "flop" and detail.actions[0].amount == 4.0


def test_row_order_is_irrelevant() -> None:
    """The same values in a different key order produce the same model."""
    row = {
        "is_allin": 1,
        "to_call": Decimal("2"),
        "pot_before": Decimal("10"),
        "amount_to": Decimal("12"),
        "amount": Decimal("10"),
        "action_type": "raise",
        "seat": 4,
        "street": "turn",
        "action_index": 9,
    }
    out = action_from_row(row)
    assert (out.action_index, out.street, out.action_type, out.is_allin) == (
        9,
        "turn",
        "raise",
        True,
    )


def test_summary_collapses_board_whitespace() -> None:
    row = {
        "hand_uid": "x",
        "site": "ggpoker",
        "played_at_utc": datetime(2026, 1, 1, tzinfo=UTC),
        "stake_level": "NL10",
        "seat": 3,
        "position": "CO",
        "hole_cards": "",
        "board": "Ah Td 7c  ",
        "net_won_bb": Decimal("-1.5"),
        "went_to_showdown": 1,
    }
    summary = summary_from_row(row)
    assert summary.board == "Ah Td 7c" and summary.went_to_showdown is True
    assert summary.net_won_bb == -1.5
