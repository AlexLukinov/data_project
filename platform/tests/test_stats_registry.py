"""The stat registry: complete, internally consistent, and loud about mistakes.

Two halves. The first loads the REAL registry and checks it against what the product already
promises (every v1 stat, the core enums). The second writes deliberately broken registries to a
temp directory and asserts that each mistake is rejected with a message naming the file, the
entry and the leaf -- because a registry error a YAML author cannot locate is a registry error
that gets worked around instead of fixed.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core import enums
from scripts.v1_stats import V1_STATS
from stats.ast import All, CountIf, parse_expr, parse_node
from stats.errors import RegistryError
from stats.registry import load_registry, registry

# ---- the real registry -------------------------------------------------------------------


def test_every_v1_stat_has_an_entry() -> None:
    """Plan step C.1 "Done means": nothing the API serves today is missing."""
    missing = sorted(set(V1_STATS) - set(registry().stats))
    assert not missing, f"v1 stats without a registry entry: {missing}"


def test_registry_is_bigger_than_v1() -> None:
    """The stats v1 could not express (aggression factor and frequency) are here."""
    reg = registry()
    for code in ("af_flop", "af_total", "afq_river", "call_cbet_flop", "sd_bb_per_100"):
        assert code in reg.stats, code


def test_enum_dimensions_mirror_the_core_enums() -> None:
    """A parser enum value the registry does not know would be unfilterable, silently."""
    reg = registry()
    assert reg.dimension("site").values == [s.value for s in enums.Site]
    assert reg.dimension("game_type").values == [g.value for g in enums.GameType]
    assert reg.dimension("table_format").values == [t.value for t in enums.TableFormat]
    assert set(reg.dimension("position").values) == {p.value for p in enums.Position}
    assert set(reg.dimension("action").values) < {a.value for a in enums.ActionType}
    assert set(reg.dimension("street").values) < {s.value for s in enums.Street}


def test_rollup_holds_only_the_coarse_dimensions() -> None:
    coarse = {d.code for d in registry().dimensions_on("stats_daily")}
    assert coarse == {"site", "stake_level", "game_type", "table_format", "position"}


def test_both_stat_forms_expose_one_shape() -> None:
    reg = registry()
    fold = reg.stat("fold_to_cbet_flop")
    assert isinstance(fold.numerator_expr, CountIf)
    assert isinstance(fold.numerator_expr.count_if, All)
    assert fold.denominator_expr == CountIf(count_if=fold.situation)
    assert fold.table == "decisions"
    hands = reg.stat("hands")
    assert hands.denominator_expr is None and hands.format == "count"
    assert reg.stat("vpip").table == "player_hands"


def test_cached_stats_are_additive() -> None:
    for stat in registry().stats.values():
        if stat.cached:
            assert stat.numerator_expr, stat.code
    assert not registry().stat("af_flop").cached


def test_unknown_codes_raise() -> None:
    with pytest.raises(RegistryError, match="unknown stat"):
        registry().stat("vpipp")
    with pytest.raises(RegistryError, match="unknown dimension"):
        registry().dimension("sprr")


# ---- checking user input against the real registry --------------------------------------


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ({"dim": "sprr", "op": "eq", "value": 1}, "unknown dimension 'sprr'"),
        ({"dim": "spr", "op": "prefix", "value": "3"}, "op 'prefix' is not allowed on number"),
        ({"dim": "facing", "op": "eq", "value": "3-bet"}, "'3-bet' is not a value of 'facing'"),
        ({"dim": "is_ip", "op": "eq", "value": 2}, "'is_ip' is a bool"),
        ({"dim": "is_ip", "op": "eq", "value": "1"}, "'is_ip' is a bool"),
        ({"dim": "spr", "op": "lt", "value": "three"}, "'spr' is a number"),
        ({"dim": "spr", "op": "between", "value": [1, "x"]}, "'spr' is a number"),
        ({"dim": "street_line", "op": "prefix", "value": 1}, "'street_line' is a line"),
        (
            {
                "all": [
                    {"dim": "street", "op": "eq", "value": "flop"},
                    {"dim": "x", "op": "eq", "value": 1},
                ]
            },
            r"filter\.all\[1\]: unknown dimension 'x'",
        ),
    ],
)
def test_bad_filters_are_named(raw: object, message: str) -> None:
    with pytest.raises(RegistryError, match=message):
        registry().check_node(parse_node(raw), "decisions")


def test_a_dimension_off_the_table_is_rejected() -> None:
    node = parse_node({"dim": "spr", "op": "gte", "value": 3})
    registry().check_node(node, "decisions")
    with pytest.raises(RegistryError, match="'spr' is not on table 'player_hands'"):
        registry().check_node(node, "player_hands")


def test_sum_needs_a_number_dimension() -> None:
    registry().check_expr(parse_expr({"sum": "net_won_bb"}), "player_hands")
    with pytest.raises(RegistryError, match=r"expr\.sum: 'position' has type enum"):
        registry().check_expr(parse_expr({"sum": "position"}), "player_hands")
    with pytest.raises(RegistryError, match=r"expr.div\[1\].countIf: unknown dimension"):
        registry().check_expr(
            parse_expr(
                {"div": [{"count": True}, {"countIf": {"dim": "nope", "op": "eq", "value": 1}}]}
            ),
            "decisions",
        )


# ---- broken registries -----------------------------------------------------------------

DIMENSIONS = """
- {code: street, label: Street, type: enum, values: [preflop, flop], tables: [decisions]}
- {code: action, label: Action, type: enum, values: [fold, call, raise], tables: [decisions]}
- {code: spr, label: SPR, type: number, tables: [decisions]}
- {code: did_vpip, label: VPIP, type: bool, tables: [player_hands]}
"""

GOOD_STAT = """
- code: fold_flop
  label: Fold flop
  category: postflop
  grain: decision
  situation: {dim: street, op: eq, value: flop}
  action: {dim: action, op: eq, value: fold}
  description: Folded on the flop.
"""


def _registry(tmp_path: Path, stats_yaml: str, dimensions_yaml: str = DIMENSIONS) -> Path:
    (tmp_path / "dimensions.yaml").write_text(dimensions_yaml)
    (tmp_path / "stats").mkdir()
    (tmp_path / "stats" / "test.yaml").write_text(stats_yaml)
    return tmp_path


def test_a_minimal_registry_loads(tmp_path: Path) -> None:
    reg = load_registry(_registry(tmp_path, GOOD_STAT))
    assert list(reg.stats) == ["fold_flop"]
    assert reg.stat("fold_flop").grain == "decision"


@pytest.mark.parametrize(
    ("stat_yaml", "message"),
    [
        (
            GOOD_STAT.replace("dim: street", "dim: streat"),
            "test.yaml: fold_flop: situation: unknown dimension 'streat'",
        ),
        (
            GOOD_STAT.replace("op: eq, value: flop", "op: prefix, value: flop"),
            "op 'prefix' is not allowed on enum dimension 'street'",
        ),
        (
            GOOD_STAT.replace("value: fold", "value: flod"),
            "action: 'flod' is not a value of 'action'",
        ),
        (
            GOOD_STAT.replace("grain: decision", "grain: hand"),
            "'street' is not on table 'player_hands'",
        ),
        (GOOD_STAT + GOOD_STAT, "duplicate stat 'fold_flop'"),
        (GOOD_STAT.replace("  description: Folded on the flop.\n", ""), "description"),
        (
            GOOD_STAT.replace("  action: {dim: action, op: eq, value: fold}\n", ""),
            "situation and action come together",
        ),
        (GOOD_STAT + "  numerator: {count: true}\n", r"EITHER situation \+ action OR numerator"),
        (
            GOOD_STAT.replace("grain: decision", "grain: decision\n  format: ratio"),
            r"situation \+ action stats are percentages",
        ),
        (GOOD_STAT.replace("op: eq, value: flop", "op: eq, value: [flop]"), "needs a single value"),
        (GOOD_STAT.replace("code: fold_flop", "code: Fold-Flop"), "code"),
        ("- code: x\n  label: x\n", r"test\.yaml: entry 0 \(x\): category: Field required"),
        ("not: a list", "expected a list of entries"),
        ("- just a string", "entry 0 is not a mapping"),
        ("- {code: [unclosed", "not valid YAML"),
    ],
)
def test_broken_stat_entries_are_rejected_with_a_location(
    tmp_path: Path, stat_yaml: str, message: str
) -> None:
    with pytest.raises(RegistryError, match=message):
        load_registry(_registry(tmp_path, stat_yaml))


def test_cached_stat_with_arithmetic_is_rejected(tmp_path: Path) -> None:
    stat = """
- code: af
  label: AF
  category: postflop
  grain: decision
  format: ratio
  cached: true
  numerator: {add: [{count: true}, {count: true}]}
  denominator: {count: true}
  description: Nonsense, but well-formed.
"""
    with pytest.raises(RegistryError, match="cached stat must be plain counts or sums"):
        load_registry(_registry(tmp_path, stat))


@pytest.mark.parametrize(
    ("dimensions_yaml", "message"),
    [
        (
            DIMENSIONS.replace("values: [preflop, flop]", "values: []"),
            "enum dimension must list its values",
        ),
        (
            DIMENSIONS.replace("type: number", "type: number, values: [a]"),
            "only enum dimensions list values",
        ),
        (
            DIMENSIONS.replace("type: number", "type: number, ops: [prefix]"),
            "not valid on a number dimension",
        ),
        (
            DIMENSIONS.replace("type: number", "type: bool, buckets: {low: [0, 1]}"),
            "buckets belong to number",
        ),
        (
            DIMENSIONS.replace("type: number", "type: number, buckets: {bad: [5, 1]}"),
            "low must be below high",
        ),
        (
            DIMENSIONS.replace("type: number, tables: [decisions]", "type: number, tables: []"),
            "tables",
        ),
        (DIMENSIONS + DIMENSIONS.splitlines()[1] + "\n", "duplicate dimension 'street'"),
        (DIMENSIONS.replace("tables: [decisions]}", "tables: [decisions], colour: red}"), "colour"),
    ],
)
def test_broken_dimensions_are_rejected(tmp_path: Path, dimensions_yaml: str, message: str) -> None:
    with pytest.raises(RegistryError, match=message):
        load_registry(_registry(tmp_path, GOOD_STAT, dimensions_yaml))


def test_a_registry_without_stat_files_is_an_error(tmp_path: Path) -> None:
    (tmp_path / "dimensions.yaml").write_text(DIMENSIONS)
    (tmp_path / "stats").mkdir()
    with pytest.raises(RegistryError, match="no stat files"):
        load_registry(tmp_path)
