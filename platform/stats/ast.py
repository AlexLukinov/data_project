"""Filters and stat expressions as a typed JSON tree (ADR-022).

    Node := Leaf | {"all": [Node, ...]} | {"any": [Node, ...]} | {"not": Node}
    Leaf := {"dim": <dimension code>, "op": <op>, "value": <scalar | [scalar, ...] | [low, high]>}
    Expr := {"count": true} | {"sum": <number dimension>} | {"countIf": Node}
          | {"add" | "sub" | "mul" | "div": [Expr, Expr, ...]}

This module knows the SHAPE of a tree and nothing about dimensions: an unknown op or a
`between` without exactly two bounds fails here; an unknown dimension or a value outside an
enum fails in `stats.checks`, against the registry. Keeping the two apart means a saved filter
can be parsed without loading the registry, and the registry can be validated without a
database.

One grammar describes a built-in stat's situation, a user's saved filter and a custom stat's
numerator, so the UI's situation builder, the API and the compiler cannot disagree about it.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

Op = Literal["in", "not_in", "eq", "ne", "lt", "lte", "gt", "gte", "between", "prefix", "like"]
LIST_OPS: frozenset[str] = frozenset({"in", "not_in", "between"})
"""Ops whose value is a list. Every other op takes one scalar."""

Scalar = str | int | float
CODE = r"^[a-z][a-z0-9_]{0,63}$"
"""Dimension and stat codes: what may become a SQL alias or a YAML key, nothing else."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class Leaf(_Strict):
    """One comparison: `dim op value`."""

    dim: str = Field(pattern=CODE)
    op: Op
    value: Scalar | list[Scalar]

    @model_validator(mode="after")
    def _shape(self) -> Leaf:
        """The value's shape follows the op: a list for `in`/`not_in`/`between`, else a scalar."""
        if isinstance(self.value, list):
            if self.op not in LIST_OPS:
                raise ValueError(f"op {self.op!r} needs a single value, not a list")
            if not self.value:
                raise ValueError(f"op {self.op!r} needs at least one value")
            if self.op == "between" and len(self.value) != 2:
                raise ValueError("op 'between' needs exactly [low, high]")
        elif self.op in LIST_OPS:
            raise ValueError(f"op {self.op!r} needs a list value")
        return self


class All(_Strict):
    """True when every child is true. An empty list is true: 'every row'."""

    all: list[Node]


class AnyOf(_Strict):
    """True when at least one child is true."""

    any: list[Node] = Field(min_length=1)


class Not(_Strict):
    """Negation."""

    not_: Node = Field(alias="not")


Node = Leaf | All | AnyOf | Not


class Count(_Strict):
    """The number of rows at the stat's grain."""

    count: Literal[True]


class Sum(_Strict):
    """The sum of a number dimension."""

    sum: str = Field(pattern=CODE)


class CountIf(_Strict):
    """The number of rows where the node holds."""

    count_if: Node = Field(alias="countIf")


class Add(_Strict):
    """Sum of two or more expressions."""

    add: list[Expr] = Field(min_length=2)


class Sub(_Strict):
    """First expression minus the rest."""

    sub: list[Expr] = Field(min_length=2)


class Mul(_Strict):
    """Product of two or more expressions."""

    mul: list[Expr] = Field(min_length=2)


class Div(_Strict):
    """First expression divided by the rest."""

    div: list[Expr] = Field(min_length=2)


Expr = Count | Sum | CountIf | Add | Sub | Mul | Div
Arithmetic = Add | Sub | Mul | Div
Term = Count | Sum | CountIf

for _model in (All, AnyOf, Not, CountIf, Add, Sub, Mul, Div):
    _model.model_rebuild()

_NODE = TypeAdapter[Node](Node)
_EXPR = TypeAdapter[Expr](Expr)


def parse_node(raw: object) -> Node:
    """A filter tree from plain data (JSON body, YAML entry). Raises `pydantic.ValidationError`."""
    return _NODE.validate_python(raw)


def parse_expr(raw: object) -> Expr:
    """An expression tree from plain data. Raises `pydantic.ValidationError`."""
    return _EXPR.validate_python(raw)


def leaves(node: Node) -> Iterator[Leaf]:
    """Every comparison in a tree, depth first."""
    if isinstance(node, Leaf):
        yield node
    elif isinstance(node, All):
        for child in node.all:
            yield from leaves(child)
    elif isinstance(node, AnyOf):
        for child in node.any:
            yield from leaves(child)
    else:
        yield from leaves(node.not_)


def operands(expr: Arithmetic) -> tuple[str, list[Expr]]:
    """(operator name, children) of an arithmetic node."""
    if isinstance(expr, Add):
        return "add", expr.add
    if isinstance(expr, Sub):
        return "sub", expr.sub
    if isinstance(expr, Mul):
        return "mul", expr.mul
    return "div", expr.div


def terms(expr: Expr) -> Iterator[Term]:
    """Every terminal of an expression: the counts and sums its arithmetic combines."""
    if isinstance(expr, Arithmetic):
        for child in operands(expr)[1]:
            yield from terms(child)
    else:
        yield expr


def is_additive(expr: Expr) -> bool:
    """True when the expression is a plain count or sum, so daily partial sums add up.

    That is what lets a stat live on the rollup: `sum(x_action) / sum(x_opp)` over days is
    exact for counts and sums, and wrong for anything with arithmetic inside (a ratio of
    ratios does not sum).
    """
    return not isinstance(expr, Arithmetic)
