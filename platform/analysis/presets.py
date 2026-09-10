"""Report presets: the landing state of each analysis area, as YAML (plan §2.2, §2.8).

    reports:
      - code: by_position
        label: By position
        description: The core numbers, one row per seat.
        request: {stats: [vpip, pfr, threebet], group_by: [position]}

A preset is a `ReportRequest` with a name. Loading validates every one against the registry
(`stats.service.validate_request`) and pins its dataset to the module's own, so a preset that
cannot run fails when the module loads, not in a user's browser. Adding a preset is one YAML
entry.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import Field

from stats.ast import CODE, _Strict
from stats.errors import RegistryError, ReportError
from stats.registry import Registry, registry
from stats.request import Dataset, ReportRequest
from stats.service import validate_request


class Preset(_Strict):
    """A named report a user can open with one click."""

    code: str = Field(pattern=CODE)
    label: str = Field(min_length=1)
    description: str = ""
    request: ReportRequest


def read_yaml(path: Path) -> dict[str, Any]:
    """The file as a mapping; a syntax error or a non-mapping names the file."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise RegistryError(f"{path.name}: {exc}") from exc
    if not isinstance(raw, dict):
        raise RegistryError(f"{path.name}: expected a mapping at the top level")
    return raw


def load_presets(path: Path, dataset: Dataset, reg: Registry | None = None) -> list[Preset]:
    """The `reports` of one presets file, each validated end to end on `dataset`."""
    reg = reg or registry()
    presets: list[Preset] = []
    seen: set[str] = set()
    for i, entry in enumerate(read_yaml(path).get("reports") or []):
        try:
            preset = Preset.model_validate(entry)
        except ValueError as exc:
            raise RegistryError(f"{path.name} reports[{i}]: {exc}") from exc
        if preset.code in seen:
            raise RegistryError(f"{path.name}: duplicate preset {preset.code!r}")
        seen.add(preset.code)
        if preset.request.dataset != dataset:
            raise RegistryError(f"{path.name} {preset.code!r}: dataset must be {dataset!r}")
        try:
            validate_request(preset.request, reg)
        except (ReportError, RegistryError) as exc:
            raise RegistryError(f"{path.name} {preset.code!r}: {exc}") from exc
        presets.append(preset)
    return presets
