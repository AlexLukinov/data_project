"""YAML files -> typed, checked entries, with errors that name the file and the entry."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import cast

import yaml
from pydantic import BaseModel, ValidationError

from stats.checks import check_expr, check_node
from stats.definitions import Dimension, Stat
from stats.errors import RegistryError

Entry = dict[str, object]


def read_entries(path: Path) -> list[Entry]:
    """The YAML list at `path`. Anything but a list of mappings is an error."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise RegistryError(f"{path.name}: not valid YAML: {exc}") from exc
    if not isinstance(raw, list):
        raise RegistryError(f"{path.name}: expected a list of entries")
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise RegistryError(f"{path.name}: entry {i} is not a mapping")
    return cast(list[Entry], raw)


def parse_entry[M: BaseModel](model: type[M], raw: Entry, where: str) -> M:
    """Validate one entry, turning Pydantic's error list into one located line."""
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise RegistryError(f"{where}: {_explain(exc)}") from exc


def _explain(exc: ValidationError) -> str:
    """Pydantic's first error as one line: `situation.all.1.op: Input should be ...`."""
    first = exc.errors()[0]
    loc = ".".join(str(part) for part in first["loc"])
    message = first["msg"].removeprefix("Value error, ")
    return f"{loc}: {message}" if loc else message


def load_dimensions(path: Path) -> dict[str, Dimension]:
    """Every dimension in `dimensions.yaml`, keyed by code. Duplicates are an error."""
    dims: dict[str, Dimension] = {}
    for i, raw in enumerate(read_entries(path)):
        dim = parse_entry(Dimension, raw, f"{path.name}: entry {i} ({raw.get('code', '?')})")
        if dim.code in dims:
            raise RegistryError(f"{path.name}: duplicate dimension {dim.code!r}")
        dims[dim.code] = dim
    return dims


def load_stats(folder: Path, dims: Mapping[str, Dimension]) -> dict[str, Stat]:
    """Every stat in `folder/*.yaml`, checked against `dims`, keyed by code."""
    stats: dict[str, Stat] = {}
    files = sorted(folder.glob("*.yaml"))
    if not files:
        raise RegistryError(f"{folder}: no stat files")
    for path in files:
        for i, raw in enumerate(read_entries(path)):
            where = f"{path.name}: entry {i} ({raw.get('code', '?')})"
            stat = parse_entry(Stat, raw, where)
            if stat.code in stats:
                raise RegistryError(f"{path.name}: duplicate stat {stat.code!r}")
            check_stat(stat, dims, f"{path.name}: {stat.code}")
            stats[stat.code] = stat
    return stats


def check_stat(stat: Stat, dims: Mapping[str, Dimension], where: str) -> None:
    """Every predicate and term of the stat must be valid on the table of its grain."""
    table = stat.table
    if stat.situation is not None and stat.action is not None:
        check_node(stat.situation, dims, table, f"{where}: situation")
        check_node(stat.action, dims, table, f"{where}: action")
        return
    check_expr(stat.numerator_expr, dims, table, f"{where}: numerator")
    if stat.denominator is not None:
        check_expr(stat.denominator, dims, table, f"{where}: denominator")
