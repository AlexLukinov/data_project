"""The stat registry: every dimension and built-in stat, loaded from YAML and checked (ADR-021).

    from stats.registry import registry
    reg = registry()
    reg.stat("fold_to_cbet_flop").numerator_expr
    reg.dimensions_on("decisions")
    reg.check_node(user_filter, "decisions")      # before anything reaches the compiler

The files next to this module ARE the registry: `dimensions.yaml` and `stats/*.yaml`. Adding a
built-in stat is one entry in one of those files (plus `make gen` once plan step C.3 lands);
adding a dimension is one entry in `dimensions.yaml` plus the column in the dbt model that
holds it. Python only reads.

Loading checks everything once: each stat's situation, action, numerator and denominator are
validated against the dimensions of the table its grain lives on, so a typo in a YAML entry
fails in the unit tests and at API startup -- never inside a query.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from stats.ast import Expr, Node
from stats.checks import check_expr, check_node
from stats.definitions import Category, Dimension, Stat, Table
from stats.errors import RegistryError
from stats.registry.loader import load_dimensions, load_stats

DEFAULT_ROOT = Path(__file__).resolve().parent
DIMENSIONS_FILE = "dimensions.yaml"
STATS_DIR = "stats"

__all__ = ["DEFAULT_ROOT", "Registry", "RegistryError", "load_registry", "registry"]


@dataclass(frozen=True, slots=True)
class Registry:
    """Every dimension and stat, by code, already validated."""

    dimensions: dict[str, Dimension]
    stats: dict[str, Stat]

    def dimension(self, code: str) -> Dimension:
        """The dimension with this code, or `RegistryError`."""
        try:
            return self.dimensions[code]
        except KeyError:
            raise RegistryError(f"unknown dimension {code!r}") from None

    def stat(self, code: str) -> Stat:
        """The stat with this code, or `RegistryError`."""
        try:
            return self.stats[code]
        except KeyError:
            raise RegistryError(f"unknown stat {code!r}") from None

    def dimensions_on(self, table: Table) -> list[Dimension]:
        """The dimensions a query against `table` may filter or group by."""
        return [d for d in self.dimensions.values() if table in d.tables]

    def stats_in(self, category: Category) -> list[Stat]:
        """The stats of one category, in registry order."""
        return [s for s in self.stats.values() if s.category == category]

    def check_node(self, node: Node, table: Table, path: str = "filter") -> None:
        """Validate a filter tree for `table`; `RegistryError` names the bad leaf."""
        check_node(node, self.dimensions, table, path)

    def check_expr(self, expr: Expr, table: Table, path: str = "expr") -> None:
        """Validate a custom-stat expression for `table`; `RegistryError` names the bad term."""
        check_expr(expr, self.dimensions, table, path)


def load_registry(root: Path = DEFAULT_ROOT) -> Registry:
    """Load and check the registry under `root` (the built-in one by default)."""
    dimensions = load_dimensions(root / DIMENSIONS_FILE)
    stats = load_stats(root / STATS_DIR, dimensions)
    return Registry(dimensions=dimensions, stats=stats)


@lru_cache(maxsize=1)
def registry() -> Registry:
    """The built-in registry, loaded once per process."""
    return load_registry()
