"""Cohorts (plan §2.8, F-602; G.4, ADR-077, ADR-080): sets of pool players named by stat criteria.

A cohort is a `CohortSpec` -- rules like `vpip < 25 and hands >= 1000` -- that the engine
evaluates per player at query time; nothing here stores members. This module answers what a
cohort is made of (its size, its members with headline stats) and ships the presets.

**Seven presets, disjoint and total (ADR-077).** The two the pool used to ship -- regs and
recreational players -- left 39% of the pool unnamed, and an unnamed 39% quietly becomes the
denominator of every "the pool does X" sentence. The seven in `presets.yaml` partition the
(VPIP, hands) plane, so every player with a VPIP falls in exactly one; a test proves it over
every threshold the rules name. Each description carries the fold-to-flop-c-bet measured for
it, with its sample and its date, so the number a reader is about to act on sits beside the
definition they are acting on.

**Five groups (ADR-080).** A label names a human precisely; a group names behaviour. `reg_m`
plays like the mid-VPIP label, and the three sub-200-hand labels cannot be told apart, so the
groups are `all` · `reg` · `other` (mid + reg_m) · `fish` · `unknown` (the three thin ones).
Each preset declares its `group`; the group's cohort is the union of its presets' rules, which
the engine compiles as one scan (`stats.query.cohort_subquery`). The label ADR-077 called
`other` is `mid` here, so that no preset code is spelled like a group key with different
members.

**Addressing without saving.** A saved cohort is a Postgres row named by UUID. A preset and a
group are named by a key in the same scheme the client already uses for its choices --
`preset:<code>` and `group:<key>` -- through `cohort_by_key`, so a reader who never saved
"reg" can still ask for it, and `''` is the whole field.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field

from analysis.pool.service import PLAYER_STATS, PRESETS
from analysis.presets import read_yaml
from stats.ast import CODE, _Strict
from stats.cohort import cohort_size
from stats.errors import RegistryError, ReportError
from stats.registry import Registry, registry
from stats.request import (
    DATASET_POPULATION,
    Cohort,
    CohortRule,
    CohortSpec,
    CohortUnion,
    ReportRequest,
    ReportResult,
)
from stats.service import Cache, Runner, run_report, validate_request

MAX_MEMBERS = 1000

GROUP_ALL = "all"
GROUP_LABELS: dict[str, str] = {
    GROUP_ALL: "The whole field",
    "reg": "Regs",
    "other": "Other (mid-VPIP, and regs on 200-999 hands)",
    "fish": "Recreational players",
    "unknown": "Unknown (under 200 hands)",
}
"""ADR-080's five keys. `all` is everyone; every other group is the union of the presets that
declare it, and its label names the merge in words."""

PRESET_PREFIX = "preset:"
GROUP_PREFIX = "group:"
"""How a route names a preset or a group: the client's own key scheme (`pool/stats.ts` keys a
shipped cohort `preset:<code>`), so a chooser's key is sent as it stands."""


class CohortPreset(_Strict):
    """A named cohort a user can adopt as-is."""

    code: str = Field(pattern=CODE)
    label: str = Field(min_length=1)
    description: str = ""
    group: str = Field(pattern=CODE)
    """The ADR-080 group this label belongs to -- one of `GROUP_LABELS` but `all`."""
    rules: list[CohortRule] = Field(min_length=1)

    @property
    def spec(self) -> CohortSpec:
        """The rules as the engine's cohort document."""
        return CohortSpec(rules=self.rules)


class CohortGroup(_Strict):
    """One of the five groups: its key, its label, and the presets that make it up."""

    key: str
    label: str
    cohorts: list[str]
    """Preset codes, in presets order. `all` lists every one, which is literally true."""


def cohort_presets(path: Path = PRESETS, reg: Registry | None = None) -> list[CohortPreset]:
    """The `cohorts` of the presets file, each validated as a population report."""
    reg = reg or registry()
    presets: list[CohortPreset] = []
    for i, entry in enumerate(read_yaml(path).get("cohorts") or []):
        try:
            preset = CohortPreset.model_validate(entry)
            validate_request(members_request(preset.spec, limit=1), reg)
        except (ValueError, RegistryError) as exc:
            raise RegistryError(f"{path.name} cohorts[{i}]: {exc}") from exc
        if preset.group == GROUP_ALL or preset.group not in GROUP_LABELS:
            keys = ", ".join(k for k in GROUP_LABELS if k != GROUP_ALL)
            raise RegistryError(
                f"{path.name} cohorts[{i}]: group {preset.group!r} is not one of {keys}"
            )
        if any(p.code == preset.code for p in presets):
            raise RegistryError(f"{path.name}: duplicate cohort {preset.code!r}")
        presets.append(preset)
    return presets


@lru_cache(maxsize=1)
def shipped() -> list[CohortPreset]:
    """The shipped presets, loaded and validated once per process.

    `cohort_presets()` reads the YAML and compiles seven reports every call (measured 6 ms
    warm); a route resolving `?cohort=` on every replayer step must not pay that each time.
    """
    return cohort_presets()


def preset_spec(code: str, presets: list[CohortPreset] | None = None) -> CohortSpec:
    """The rules of the preset named `code`; `ReportError` names the codes when it is not one."""
    presets = shipped() if presets is None else presets
    for preset in presets:
        if preset.code == code:
            return preset.spec
    codes = ", ".join(p.code for p in presets)
    raise ReportError(f"unknown cohort preset {code!r}; the presets are: {codes}")


def groups(presets: list[CohortPreset] | None = None) -> list[CohortGroup]:
    """The five groups, each with the presets that declare it, in `GROUP_LABELS` order."""
    presets = shipped() if presets is None else presets
    return [
        CohortGroup(
            key=key,
            label=label,
            cohorts=[p.code for p in presets if key == GROUP_ALL or p.group == key],
        )
        for key, label in GROUP_LABELS.items()
    ]


def group_spec(key: str, presets: list[CohortPreset] | None = None) -> Cohort | None:
    """The cohort a group names: None for `all`, one preset's rules, or their union.

    A single-preset group hands back that preset's own `CohortSpec`, so the report it scopes
    is the same document -- and the same cache key -- as asking for the preset by name.
    """
    if key == GROUP_ALL:
        return None
    if key not in GROUP_LABELS:
        raise ReportError(f"unknown group {key!r}; the groups are: {', '.join(GROUP_LABELS)}")
    presets = shipped() if presets is None else presets
    specs = [p.spec for p in presets if p.group == key]
    if not specs:
        raise ReportError(f"group {key!r} names no preset")
    return specs[0] if len(specs) == 1 else CohortUnion(any=specs)


def cohort_by_key(key: str, presets: list[CohortPreset] | None = None) -> Cohort | None:
    """`preset:<code>` or `group:<key>` as the engine's cohort; `''` is the whole field.

    Anything else is a `ReportError` that says what a key looks like -- a saved cohort's UUID
    is a different parameter, not a different spelling of this one.
    """
    if key == "":
        return None
    if key.startswith(PRESET_PREFIX):
        return preset_spec(key.removeprefix(PRESET_PREFIX), presets)
    if key.startswith(GROUP_PREFIX):
        return group_spec(key.removeprefix(GROUP_PREFIX), presets)
    raise ReportError(
        f"cohort {key!r} is neither {PRESET_PREFIX}<code> nor {GROUP_PREFIX}<key>; "
        "a saved cohort goes in cohort_id"
    )


def members_request(spec: Cohort, *, limit: int = MAX_MEMBERS) -> ReportRequest:
    """One row per member with the headline stats: the pool grouped by player, in the cohort."""
    return ReportRequest(
        dataset=DATASET_POPULATION,
        hero_only=False,
        stats=list(PLAYER_STATS),
        group_by=["player_key"],
        cohort=spec,
        limit=min(limit, MAX_MEMBERS),
    )


def members(
    spec: Cohort,
    tenant_id: int,
    *,
    limit: int = MAX_MEMBERS,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> ReportResult:
    """The cohort's players, each with the headline stats they qualified on."""
    return run_report(members_request(spec, limit=limit), tenant_id, run=run, cache=cache, reg=reg)


def size(
    spec: Cohort, tenant_id: int, *, run: Runner | None = None, reg: Registry | None = None
) -> int:
    """How many players the cohort names."""
    return cohort_size(spec, tenant_id, run=run, reg=reg)
