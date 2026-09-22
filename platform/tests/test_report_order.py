"""Ordering a report: the allowlist on the one clause a caller shapes (ADR-065).

`stats/order.py` renders it; these assert on the SQL and the parameters it produces, the way
`test_report_query.py` does for the rest of the builder.
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from stats.ast import parse_node
from stats.errors import ReportError
from stats.query import build_query
from stats.registry import registry
from stats.request import OrderKey, OrderMatch, ReportRequest
from stats.resolve import dimensions_used, resolve_stats
from stats.router import plan


def _build(request: ReportRequest, tenant_id: int = 1) -> list[tuple[str, dict[str, Any]]]:
    reg = registry()
    stats = resolve_stats(request, reg)
    plans = plan(stats, dimensions_used(request), reg, dispersion=request.confidence is not None)
    return [build_query(request, tenant_id, p, reg) for p in plans]


def _one(request: ReportRequest, tenant_id: int = 1) -> tuple[str, dict[str, Any]]:
    queries = _build(request, tenant_id)
    assert len(queries) == 1
    return queries[0]


def test_the_default_order_is_still_the_group_key() -> None:
    sql, _ = _one(ReportRequest(group_by=["position"], stats=["vpip"]))
    assert "GROUP BY position ORDER BY position" in sql


def test_an_order_key_may_be_a_group_by_or_a_stat_of_the_same_report() -> None:
    request = ReportRequest(
        group_by=["position"],
        stats=["vpip", "hands"],
        order_by=[OrderKey(key="hands", direction="desc"), OrderKey(key="position")],
    )
    sql, _ = _one(request)
    assert "GROUP BY position ORDER BY hands DESC, position ASC LIMIT" in sql


@pytest.mark.parametrize("key", ["wtsd", "password_hash", "player_key", "hands_"])
def test_an_order_key_the_answer_does_not_have_is_refused(key: str) -> None:
    """Rule 3 on the one clause a caller shapes: not a column of this answer, not an order."""
    request = ReportRequest(group_by=["position"], stats=["vpip"], order_by=[OrderKey(key=key)])
    with pytest.raises(ReportError, match="neither a group-by nor a stat"):
        _build(request)


def test_an_order_key_is_never_caller_text() -> None:
    for bad in ("hands DESC, 1", "hands; DROP TABLE x", "(SELECT 1)", "hands--", "__hands"):
        with pytest.raises(ValidationError):
            OrderKey(key=bad)


def test_a_match_term_binds_its_value_and_qualifies_its_column() -> None:
    """A ranking predicate is an ordinary filter tree: compiled, checked and bound."""
    request = ReportRequest(
        group_by=["position"],
        stats=["vpip"],
        order_by=[OrderMatch(match=parse_node({"dim": "position", "op": "eq", "value": "BTN"}))],
    )
    sql, params = _one(request)
    assert "ORDER BY (s.position = {p0:String}) ASC LIMIT" in sql
    assert params["p0"] == "BTN" and "BTN" not in sql


def test_a_match_term_must_name_a_dimension_the_report_groups_by() -> None:
    """A column that is not a grouping key cannot be ranked under GROUP BY."""
    request = ReportRequest(
        group_by=["position"],
        stats=["vpip"],
        order_by=[
            OrderMatch(match=parse_node({"dim": "stake_level", "op": "eq", "value": "NL25"}))
        ],
    )
    with pytest.raises(ReportError, match="'stake_level' must be grouped by"):
        _build(request)


def test_a_match_term_on_a_bucketed_dimension_is_refused() -> None:
    """Grouping by `spr` selects its buckets, so `s.spr` is not a key of that query."""
    request = ReportRequest(
        group_by=["spr"],
        stats=["cbet_flop"],
        order_by=[OrderMatch(match=parse_node({"dim": "spr", "op": "gt", "value": 4}))],
    )
    with pytest.raises(ReportError, match="'spr' is grouped in buckets"):
        _build(request)


@pytest.mark.parametrize(
    "term",
    [
        {"key": "hands", "match": {"dim": "position", "op": "eq", "value": "BTN"}},
        {"direction": "desc"},
        {},
    ],
)
def test_a_term_that_is_both_shapes_or_neither_does_not_parse(term: dict[str, Any]) -> None:
    """The wire form a client actually sends: two shapes, and nothing in between."""
    asked = {"group_by": ["position"], "stats": ["vpip"], "order_by": [term]}
    with pytest.raises(ValidationError):
        ReportRequest.model_validate(asked)


def test_ordering_a_report_that_has_one_row_is_refused() -> None:
    with pytest.raises(ValidationError, match="order_by needs a group_by"):
        ReportRequest(stats=["vpip"], order_by=[OrderKey(key="vpip")])
