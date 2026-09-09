"""Registry trees -> ClickHouse SQL fragments (ADR-022).

Two renderers for values, one compiler:

  `Params`    binds every value as a named parameter (`{p3:Array(String)}`) and collects the
              values for the client. **The only renderer a request may reach.** Nothing a user
              sends becomes SQL text, ever.
  `Literals`  inlines values as SQL literals. For GENERATED files only (`scripts/gen_stats.py`
              rendering the rollup and the law test from the registry, which is code in this
              repository), where a parameter has nowhere to be bound.

Identifiers never come from a value: a leaf's `dim` is looked up in the dimension registry and
its code IS the column name (the contract in stats/registry/dimensions.yaml); `check_leaf`
runs on every leaf here again, so even a caller that forgot to validate cannot make the
compiler emit an unknown column.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from stats.ast import All, AnyOf, Count, CountIf, Expr, Leaf, Node, Not, Scalar, Sum, operands
from stats.checks import check_leaf
from stats.definitions import Dimension, Table
from stats.errors import RegistryError

COMPARISONS: dict[str, str] = {
    "eq": "=",
    "ne": "!=",
    "lt": "<",
    "lte": "<=",
    "gt": ">",
    "gte": ">=",
}
ARITHMETIC: dict[str, str] = {"add": " + ", "sub": " - ", "mul": " * "}

SCALAR_TYPES: dict[str, str] = {
    "enum": "String",
    "line": "String",
    "string": "String",
    "number": "Float64",
    "bool": "UInt8",
}
"""ClickHouse parameter type per dimension type. Numbers bind as Float64 so an integer column
compared to `3` and a float column compared to `0.37` both work through one path."""


class ValueRenderer(Protocol):
    """How a leaf's value becomes SQL text."""

    def render(self, value: Scalar | list[Scalar], dim: Dimension) -> str:
        """SQL for one scalar or one list, for a dimension of a known type."""
        ...


@dataclass(slots=True)
class Params:
    """Bound parameters, numbered in order of appearance; `values` is what the client sends."""

    prefix: str = "p"
    values: dict[str, Any] = field(default_factory=dict)

    def render(self, value: Scalar | list[Scalar], dim: Dimension) -> str:
        """`{p3:String}` or `{p3:Array(String)}`; the value is recorded under that name."""
        name = f"{self.prefix}{len(self.values)}"
        scalar_type = SCALAR_TYPES[dim.type]
        if isinstance(value, list):
            self.values[name] = list(value)
            return f"{{{name}:Array({scalar_type})}}"
        self.values[name] = value
        return f"{{{name}:{scalar_type}}}"


class Literals:
    """Inline literals. Generated SQL only -- see the module docstring."""

    def render(self, value: Scalar | list[Scalar], dim: Dimension) -> str:
        """A quoted string, a number, or a parenthesised list of them."""
        if isinstance(value, list):
            return "(" + ", ".join(self.render(v, dim) for v in value) + ")"
        if dim.type in ("enum", "line", "string"):
            return quote(str(value))
        if dim.type == "bool":
            return "1" if value else "0"
        return repr(value)


def quote(text: str) -> str:
    """A ClickHouse single-quoted string literal."""
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


@dataclass(frozen=True, slots=True)
class Compiler:
    """Node / Expr -> SQL over `table`, columns qualified with `alias` when given."""

    dims: Mapping[str, Dimension]
    table: Table
    values: ValueRenderer
    alias: str = ""

    def column(self, code: str) -> str:
        """The qualified column for a dimension code."""
        return f"{self.alias}.{code}" if self.alias else code

    def node(self, node: Node) -> str:
        """SQL for a filter tree. An empty `all` is `1` (every row)."""
        if isinstance(node, Leaf):
            return self.leaf(node)
        if isinstance(node, All):
            parts = [self.node(child) for child in node.all]
            return " AND ".join(p for p in parts if p != "1") or "1"
        if isinstance(node, AnyOf):
            return "(" + " OR ".join(self.node(child) for child in node.any) + ")"
        if isinstance(node, Not):
            return f"NOT ({self.node(node.not_)})"
        raise RegistryError(f"unknown node {node!r}")

    def leaf(self, leaf: Leaf) -> str:
        """SQL for one comparison, after re-checking it against the dimensions."""
        check_leaf(leaf, self.dims, self.table, "leaf")
        dim = self.dims[leaf.dim]
        column = self.column(leaf.dim)
        if leaf.op in COMPARISONS:
            return f"{column} {COMPARISONS[leaf.op]} {self.values.render(leaf.value, dim)}"
        if leaf.op in ("in", "not_in"):
            keyword = "IN" if leaf.op == "in" else "NOT IN"
            return f"{column} {keyword} {self.values.render(leaf.value, dim)}"
        if leaf.op == "between":
            low, high = leaf.value if isinstance(leaf.value, list) else (leaf.value, leaf.value)
            bounds = self.values.render(low, dim), self.values.render(high, dim)
            return f"{column} BETWEEN {bounds[0]} AND {bounds[1]}"
        if leaf.op == "prefix":
            return f"startsWith({column}, {self.values.render(leaf.value, dim)})"
        return f"{column} LIKE {self.values.render(leaf.value, dim)}"

    def expr(self, expr: Expr) -> str:
        """SQL for a stat expression: an aggregate, or arithmetic over aggregates."""
        if isinstance(expr, Count):
            return "count()"
        if isinstance(expr, Sum):
            dim = self.dims.get(expr.sum)
            if dim is None or self.table not in dim.tables or dim.type != "number":
                raise RegistryError(
                    f"sum({expr.sum!r}) is not a number dimension on {self.table!r}"
                )
            return f"sum({self.column(expr.sum)})"
        if isinstance(expr, CountIf):
            condition = self.node(expr.count_if)
            return "count()" if condition == "1" else f"countIf({condition})"
        name, children = operands(expr)
        parts = [self.expr(child) for child in children]
        if name == "div":
            return "(" + " / ".join([parts[0], *(f"nullIf({p}, 0)" for p in parts[1:])]) + ")"
        return "(" + ARITHMETIC[name].join(parts) + ")"
