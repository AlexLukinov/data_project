"""The registry compiler: every op maps to SQL, values never become SQL text at runtime.

`Params` is the renderer a request reaches: every value is a named parameter and the
identifiers come from the registry. `Literals` is for generated files only; its escaping is
still tested because a registry YAML value with a quote in it would otherwise break `make gen`.
"""

from __future__ import annotations

import pytest

from stats.ast import parse_expr, parse_node
from stats.compiler import Compiler, Literals, Params, quote
from stats.errors import RegistryError
from stats.registry import registry


def _literal(table: str = "decisions", alias: str = "") -> Compiler:
    return Compiler(dims=registry().dimensions, table=table, values=Literals(), alias=alias)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("raw", "sql"),
    [
        ({"dim": "street", "op": "eq", "value": "flop"}, "street = 'flop'"),
        ({"dim": "facing", "op": "ne", "value": "none"}, "facing != 'none'"),
        ({"dim": "spr", "op": "lt", "value": 3}, "spr < 3"),
        ({"dim": "spr", "op": "between", "value": [3, 6.5]}, "spr BETWEEN 3 AND 6.5"),
        ({"dim": "position", "op": "in", "value": ["CO", "BTN"]}, "position IN ('CO', 'BTN')"),
        ({"dim": "position", "op": "not_in", "value": ["SB"]}, "position NOT IN ('SB')"),
        ({"dim": "is_ip", "op": "eq", "value": 1}, "is_ip = 1"),
        ({"dim": "street_line", "op": "prefix", "value": "x"}, "startsWith(street_line, 'x')"),
        ({"dim": "line_so_far", "op": "like", "value": "r/%"}, "line_so_far LIKE 'r/%'"),
        ({"all": []}, "1"),
        (
            {
                "any": [
                    {"dim": "spr", "op": "gte", "value": 13},
                    {"dim": "is_ip", "op": "eq", "value": 0},
                ]
            },
            "(spr >= 13 OR is_ip = 0)",
        ),
        ({"not": {"dim": "action", "op": "eq", "value": "fold"}}, "NOT (action = 'fold')"),
    ],
)
def test_literal_rendering(raw: object, sql: str) -> None:
    assert _literal().node(parse_node(raw)) == sql


def test_alias_qualifies_every_column() -> None:
    sql = _literal(alias="d").node(
        parse_node(
            {
                "all": [
                    {"dim": "street", "op": "eq", "value": "flop"},
                    {"dim": "spr", "op": "gt", "value": 3},
                ]
            }
        )
    )
    assert sql == "d.street = 'flop' AND d.spr > 3"


def test_quotes_are_escaped() -> None:
    assert quote("it's") == "'it\\'s'"
    assert quote("a\\b") == "'a\\\\b'"


def test_params_bind_every_value_and_emit_no_text() -> None:
    params = Params()
    compiler = Compiler(dims=registry().dimensions, table="decisions", values=params, alias="d")
    sql = compiler.node(
        parse_node(
            {
                "all": [
                    {"dim": "position", "op": "in", "value": ["CO", "BTN"]},
                    {"dim": "spr", "op": "between", "value": [3, 6]},
                    {"dim": "hand_class", "op": "eq", "value": "AKs'); DROP TABLE x; --"},
                ]
            }
        )
    )
    assert sql == (
        "d.position IN {p0:Array(String)} AND d.spr BETWEEN {p1:Float64} AND {p2:Float64}"
        " AND d.hand_class = {p3:String}"
    )
    assert params.values == {"p0": ["CO", "BTN"], "p1": 3, "p2": 6, "p3": "AKs'); DROP TABLE x; --"}
    assert "DROP" not in sql


def test_expressions() -> None:
    compiler = _literal()
    assert compiler.expr(parse_expr({"count": True})) == "count()"
    assert compiler.expr(parse_expr({"sum": "net_won_bb"})) == "sum(net_won_bb)"
    assert (
        compiler.expr(parse_expr({"countIf": {"dim": "action", "op": "eq", "value": "bet"}}))
        == "countIf(action = 'bet')"
    )
    assert (
        compiler.expr(parse_expr({"div": [{"count": True}, {"sum": "net_won_bb"}]}))
        == "(count() / nullIf(sum(net_won_bb), 0))"
    )
    assert (
        compiler.expr(parse_expr({"add": [{"count": True}, {"count": True}, {"count": True}]}))
        == "(count() + count() + count())"
    )


def test_unknown_or_misplaced_dimensions_never_compile() -> None:
    with pytest.raises(RegistryError, match="unknown dimension"):
        _literal().node(parse_node({"dim": "sprr", "op": "eq", "value": 1}))
    with pytest.raises(RegistryError, match="not on table"):
        _literal("player_hands").node(parse_node({"dim": "spr", "op": "eq", "value": 1}))
    with pytest.raises(RegistryError, match="not a number dimension"):
        _literal().expr(parse_expr({"sum": "position"}))


def test_every_registry_stat_compiles_on_its_table() -> None:
    """Plan C.4's gate, met early: no built-in stat can fail at query time."""
    for stat in registry().stats.values():
        compiler = _literal(stat.table)
        assert compiler.expr(stat.numerator_expr).startswith(("count", "sum", "("))
        if stat.denominator_expr is not None:
            assert compiler.expr(stat.denominator_expr)
