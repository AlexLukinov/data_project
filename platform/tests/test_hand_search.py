"""A hand search is a report's filter asked backwards. Same rules, so the same tests apply:
the tenant is never in the body, every value is bound, and an unknown dimension is refused.
"""

from __future__ import annotations

from typing import Any

import pytest

from stats.errors import ReportError
from stats.hands import HandRef, find_hands, hand_search_sql
from stats.request import HandSearch

FLOP_CBET = {
    "all": [
        {"dim": "street", "op": "eq", "value": "flop"},
        {"dim": "action", "op": "eq", "value": "bet"},
    ]
}


def _sql(**kwargs: Any) -> tuple[str, dict[str, Any]]:
    return hand_search_sql(HandSearch.model_validate(kwargs), tenant_id=7)


def test_tenant_and_dataset_scope_every_search() -> None:
    sql, params = _sql(filter=FLOP_CBET)
    assert "s.user_id = {tenant_id:UInt32}" in sql
    assert "s.dataset = {dataset:String}" in sql
    assert params["tenant_id"] == 7 and params["dataset"] == "hero"
    assert "s.is_hero = 1" in sql


def test_the_filter_is_compiled_with_bound_values() -> None:
    sql, params = _sql(filter=FLOP_CBET)
    assert "'flop'" not in sql and "'bet'" not in sql
    assert "flop" in params.values() and "bet" in params.values()


def test_the_answer_is_a_decision_not_a_hand() -> None:
    """The seat comes back too: a pool hand has no hero, so the caller needs to be told."""
    sql, _ = _sql(filter=FLOP_CBET, dataset="population", hero_only=False)
    assert "s.seat AS seat" in sql
    assert "GROUP BY hand_uid, seat" in sql
    assert "ORDER BY played_at_utc DESC" in sql


def test_the_hand_id_comes_back_in_the_form_the_rest_of_the_api_uses() -> None:
    """`decisions.hand_uid` is FixedString(16); `core.hands` and every URL use the hex form.

    Without the conversion the search returns ids that match no hand, and the list is silently
    empty -- which is exactly how this was found.
    """
    sql, _ = _sql(filter=FLOP_CBET)
    assert "lower(hex(s.hand_uid)) AS hand_uid" in sql


def test_an_empty_filter_still_scopes() -> None:
    sql, params = _sql()
    assert sql.count("WHERE") == 1 and "(1)" not in sql
    assert params["limit"] == 100


def test_hero_only_is_refused_on_the_pool() -> None:
    with pytest.raises(ValueError, match="hero_only cannot be combined"):
        HandSearch(dataset="population", hero_only=True)


def test_an_unknown_dimension_is_a_report_error() -> None:
    with pytest.raises(ReportError):
        _sql(filter={"dim": "no_such_column", "op": "eq", "value": 1})


def test_a_dimension_the_decision_table_lacks_is_refused() -> None:
    """`did_vpip` lives on `player_hands`; a hand search only reads decisions."""
    with pytest.raises(ReportError):
        _sql(filter={"dim": "did_vpip", "op": "eq", "value": 1})


def test_find_hands_returns_refs_in_query_order() -> None:
    rows = [["a", 3, "2026-01-02"], ["b", 5, "2026-01-01"]]

    def run(sql: str, params: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
        assert params["tenant_id"] == 7
        return ["hand_uid", "seat", "played_at_utc"], rows

    assert find_hands(HandSearch(), 7, run=run) == [
        HandRef(hand_uid="a", seat=3),
        HandRef(hand_uid="b", seat=5),
    ]
