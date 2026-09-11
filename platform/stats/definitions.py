"""What a registry entry is: a dimension to filter or group by, and a stat (ADR-021).

The typed forms of `stats/registry/dimensions.yaml` and `stats/registry/stats/*.yaml`. Rules
about one entry's own shape live here as validators (an enum dimension lists its values; a stat
is EITHER situation + action OR numerator + denominator). Rules that need the whole registry --
does the dimension exist, is it on this table, is the value one of its enum values -- live in
`stats.checks`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, computed_field, model_validator

from stats.ast import CODE, All, CountIf, Expr, Node, Op, _Strict, is_additive

Table = Literal["decisions", "player_hands", "stats_daily"]
DimType = Literal["enum", "number", "bool", "line", "string"]
Category = Literal["preflop", "postflop", "showdown", "money"]
Grain = Literal["hand", "decision"]
Format = Literal["percent", "ratio", "per100", "count"]

OPS_BY_TYPE: dict[str, frozenset[str]] = {
    "enum": frozenset({"in", "not_in", "eq", "ne"}),
    "bool": frozenset({"eq", "ne"}),
    "number": frozenset({"eq", "ne", "lt", "lte", "gt", "gte", "between", "in", "not_in"}),
    "line": frozenset({"eq", "ne", "in", "not_in", "prefix", "like"}),
    "string": frozenset({"eq", "ne", "in", "not_in", "prefix", "like"}),
}
"""Which comparisons make sense on which kind of column. A registry entry may narrow this
list (`ops:`), never widen it."""

TABLE_FOR_GRAIN: dict[str, Table] = {"hand": "player_hands", "decision": "decisions"}

Range = tuple[float | None, float | None]
"""A presentation bucket: [low, high), `null` for an open end."""

ROUNDING: dict[Format, int] = {"percent": 2, "per100": 3, "ratio": 3, "count": 0}
"""Decimals a value of each format is printed to. A property of the format, so the query
builder and `stats.interval` round a value and the bounds around it the same way."""


class Dimension(_Strict):
    """A column a filter, a group-by or a custom stat may name."""

    code: str = Field(pattern=CODE)
    label: str = Field(min_length=1)
    type: DimType
    tables: list[Table] = Field(min_length=1)
    description: str = ""
    values: list[str] = Field(default_factory=list)
    ops: list[Op] | None = None
    group_by: bool = True
    buckets: dict[str, Range] = Field(default_factory=dict)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def allowed_ops(self) -> list[str]:
        """The ops this dimension accepts: the entry's own list, else the defaults for its type.

        Serialized with the dimension (a computed field), so `/v1/definitions` tells the UI
        what it may offer without the UI knowing the per-type defaults.
        """
        return sorted(self.ops) if self.ops is not None else sorted(OPS_BY_TYPE[self.type])

    @model_validator(mode="after")
    def _consistent(self) -> Dimension:
        """Values only on enums, buckets only on numbers, ops within the type's set."""
        if self.type == "enum" and not self.values:
            raise ValueError("an enum dimension must list its values")
        if self.type != "enum" and self.values:
            raise ValueError(f"only enum dimensions list values, not a {self.type}")
        if len(set(self.values)) != len(self.values):
            raise ValueError("duplicate enum value")
        if self.buckets and self.type != "number":
            raise ValueError("buckets belong to number dimensions only")
        unexpected = set(self.allowed_ops) - OPS_BY_TYPE[self.type]
        if unexpected:
            raise ValueError(f"ops {sorted(unexpected)} are not valid on a {self.type} dimension")
        for name, (low, high) in self.buckets.items():
            if low is not None and high is not None and low >= high:
                raise ValueError(f"bucket {name!r}: low must be below high")
        return self


class Stat(_Strict):
    """A built-in statistic.

    Two forms. `situation` + `action` is the common one: the value is
    `countIf(situation AND action) / countIf(situation)`, a percentage. `numerator` (+
    `denominator`) is the general one, for money per 100 hands, plain ratios (aggression
    factor) and counts. Both expose the same `numerator_expr` / `denominator_expr`, so the
    compiler sees one shape.
    """

    code: str = Field(pattern=CODE)
    label: str = Field(min_length=1)
    category: Category
    grain: Grain
    format: Format = "percent"
    situation: Node | None = None
    action: Node | None = None
    numerator: Expr | None = None
    denominator: Expr | None = None
    higher_is_better: bool | None = None
    typical: tuple[float, float] | None = None
    cached: bool = False
    description: str = Field(min_length=1)
    notes: str = ""

    @property
    def table(self) -> Table:
        """The fact table this stat is computed on."""
        return TABLE_FOR_GRAIN[self.grain]

    @property
    def numerator_expr(self) -> Expr:
        """What is counted or summed on top."""
        if self.numerator is not None:
            return self.numerator
        if self.situation is None or self.action is None:
            raise ValueError(f"stat {self.code!r} has neither form")
        return CountIf(count_if=All(all=[self.situation, self.action]))

    @property
    def denominator_expr(self) -> Expr | None:
        """What it is divided by; None for a bare count."""
        if self.situation is not None:
            return CountIf(count_if=self.situation)
        return self.denominator

    @model_validator(mode="after")
    def _one_form(self) -> Stat:
        """Exactly one of the two forms, with a denominator unless it is a count."""
        pair = self.situation is not None or self.action is not None
        if pair and (self.situation is None or self.action is None):
            raise ValueError("situation and action come together")
        if pair == (self.numerator is not None):
            raise ValueError("a stat is EITHER situation + action OR numerator (+ denominator)")
        if pair and self.format != "percent":
            raise ValueError("situation + action stats are percentages; use numerator/denominator")
        if self.format == "count" and self.denominator is not None:
            raise ValueError("a count has no denominator")
        if self.format != "count" and not pair and self.denominator is None:
            raise ValueError(f"format {self.format!r} needs a denominator")
        if self.typical is not None and self.typical[0] > self.typical[1]:
            raise ValueError("typical is [low, high]")
        if self.cached and not self._is_additive():
            raise ValueError("a cached stat must be plain counts or sums (no arithmetic)")
        return self

    def _is_additive(self) -> bool:
        denominator = self.denominator_expr
        return is_additive(self.numerator_expr) and (
            denominator is None or is_additive(denominator)
        )
