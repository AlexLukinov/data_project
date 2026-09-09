"""Semantic checks of a tree against the dimension registry.

`stats.ast` guarantees shape; this guarantees meaning: every dimension exists, is held by the
table being queried, allows the op, and the value fits its type (an enum value is one of the
declared values, a bool is 0 or 1, a number is a number). A failure names the exact leaf, so a
registry author or an API caller reads
`situation.all[1]: op 'prefix' is not allowed on number dimension 'spr'`
rather than a ClickHouse error.
"""

from __future__ import annotations

from collections.abc import Mapping

from stats.ast import All, AnyOf, Count, CountIf, Expr, Leaf, Node, Scalar, Sum, operands
from stats.definitions import Dimension, Table
from stats.errors import RegistryError


def check_node(node: Node, dims: Mapping[str, Dimension], table: Table, path: str) -> None:
    """Raise `RegistryError` unless every leaf of `node` is valid on `table`."""
    if isinstance(node, Leaf):
        check_leaf(node, dims, table, path)
    elif isinstance(node, All):
        for i, child in enumerate(node.all):
            check_node(child, dims, table, f"{path}.all[{i}]")
    elif isinstance(node, AnyOf):
        for i, child in enumerate(node.any):
            check_node(child, dims, table, f"{path}.any[{i}]")
    else:
        check_node(node.not_, dims, table, f"{path}.not")


def check_leaf(leaf: Leaf, dims: Mapping[str, Dimension], table: Table, path: str) -> None:
    """One comparison: dimension known and on the table, op allowed, every value typed."""
    dim = _dimension(leaf.dim, dims, table, path)
    if leaf.op not in dim.allowed_ops:
        raise RegistryError(
            f"{path}: op {leaf.op!r} is not allowed on {dim.type} dimension {dim.code!r} "
            f"(allowed: {sorted(dim.allowed_ops)})"
        )
    values = leaf.value if isinstance(leaf.value, list) else [leaf.value]
    for value in values:
        _check_value(dim, value, path)


def check_expr(expr: Expr, dims: Mapping[str, Dimension], table: Table, path: str) -> None:
    """Raise `RegistryError` unless every term of `expr` is valid on `table`."""
    if isinstance(expr, Count):
        return
    if isinstance(expr, Sum):
        dim = _dimension(expr.sum, dims, table, f"{path}.sum")
        if dim.type != "number":
            raise RegistryError(
                f"{path}.sum: {dim.code!r} has type {dim.type}; sum() needs a number dimension"
            )
    elif isinstance(expr, CountIf):
        check_node(expr.count_if, dims, table, f"{path}.countIf")
    else:
        name, children = operands(expr)
        for i, child in enumerate(children):
            check_expr(child, dims, table, f"{path}.{name}[{i}]")


def _dimension(code: str, dims: Mapping[str, Dimension], table: Table, path: str) -> Dimension:
    dim = dims.get(code)
    if dim is None:
        raise RegistryError(f"{path}: unknown dimension {code!r}")
    if table not in dim.tables:
        raise RegistryError(
            f"{path}: dimension {code!r} is not on table {table!r} (it is on {dim.tables})"
        )
    return dim


def _check_value(dim: Dimension, value: Scalar, path: str) -> None:
    """The value must fit the dimension's type; enum values must be declared."""
    if dim.type == "enum":
        if not isinstance(value, str) or value not in dim.values:
            raise RegistryError(
                f"{path}: {value!r} is not a value of {dim.code!r} (one of {dim.values})"
            )
    elif dim.type == "bool":
        if isinstance(value, str) or value not in (0, 1):
            raise RegistryError(f"{path}: {dim.code!r} is a bool; use 0 or 1, not {value!r}")
    elif dim.type == "number":
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise RegistryError(f"{path}: {dim.code!r} is a number; {value!r} is not")
    elif not isinstance(value, str):
        raise RegistryError(f"{path}: {dim.code!r} is a {dim.type}; {value!r} is not text")
