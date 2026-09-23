"""`NodeKey` -> a filter over `marts.decisions` (ADR-028, plan F.8).

A node **is** a predicate: the decision rows where a seat in hero's position faces exactly what
the key's sequence puts in front of it. The key's last step is hero's own action, so it is not
part of the filter — it is the thing whose frequency the pool reports.

Everything here maps onto columns the decision fact already has (ADR-020); no new grammar and
no bucket boundary is written twice: `eff_stack_bb` is matched by the registry's own bucket.
"""

from __future__ import annotations

from collections.abc import Sequence

from analysis.pool.nodes import ActionStep, NodeKey, Position, Street, own_line
from stats.ast import All, Leaf, Node
from stats.definitions import Dimension
from stats.errors import RegistryError
from stats.registry import Registry, registry

AGGRESSIVE = frozenset({"bet", "raise", "allin"})

FACED_SIZE = "facing_size_pct"
"""The dimension a key's `size_bucket` names a bucket of: the bet in front, over the pot."""

PREFLOP_FACING: dict[int, str] = {0: "raise", 1: "3bet", 2: "4bet"}
"""Raises in front -> `facing`, preflop. Three or more is `5bet_plus`."""

POSTFLOP_FACING: dict[int, str] = {1: "bet", 2: "raise"}
"""Bets and raises in front -> `facing`, postflop. Three or more is `3bet`."""

OPEN_ENDED = 1e9
"""Stands in for the open top of the last bucket; no stack, pot or size comes near it."""

TEXTURE_DIMENSIONS = (
    "flop_suitedness",
    "flop_pairing",
    "flop_connectivity",
    "flop_high_card_class",
    "turn_change",
    "river_change",
    "flop_high_card",
)
"""Where a `board_texture` tag is looked up. A tag IS one of these dimensions' values.

The first dimension holding the value wins, so no value may be declared by two of them:
`tests/test_texture_tags.py` pins that against the registry, and the runout dimensions carry
their street in every value (`turn_blank`, `river_blank`) for exactly that reason (ADR-082).
The first six are the board hierarchy of ADR-079 -- flop class, then the turn, then the river
-- in the order `textureTags()` in poker-core emits them; `flop_high_card`, the raw rank, is a
tag a person may type and the replayer never emits, so it comes last.
"""

TEXTURE_STREET: dict[str, Street] = {
    "flop_suitedness": "flop",
    "flop_pairing": "flop",
    "flop_connectivity": "flop",
    "flop_high_card_class": "flop",
    "flop_high_card": "flop",
    "turn_change": "turn",
    "river_change": "river",
}
"""The first street each texture dimension is set on. Before it the column reads '', so a
turn tag on a flop node would be a filter that matches no row and says nothing."""

STREET_ORDER: tuple[Street, ...] = ("preflop", "flop", "turn", "river")

POSTFLOP_ORDER: tuple[str, ...] = (
    "SB",
    "BB",
    "UTG",
    "UTG1",
    "UTG2",
    "MP",
    "MP1",
    "HJ",
    "CO",
    "BTN",
)
"""Who acts first after the flop. Later in this list is later to act, which is `is_ip`."""


def _line_leaf(key: NodeKey, before: list[ActionStep]) -> Leaf:
    """Hero's own line: across streets when the key says so, else this street only (ADR-078).

    A key carries one or the other, never both: `line_so_far` already ends with this street's
    actions (the model checks that against the sequence), so a `street_line` leaf beside it
    would say the same thing twice.
    """
    if key.line_so_far is not None:
        return Leaf(dim="line_so_far", op="eq", value=key.line_so_far)
    line_dim = "preflop_line" if key.street == "preflop" else "street_line"
    return Leaf(dim=line_dim, op="eq", value=own_line(before, key.hero_position))


def _facing(steps: list[ActionStep], street: Street) -> str:
    """What is in front of hero, exactly as `dimensions.yaml` defines `facing`.

    It counts the aggression on the street, not the aggression since hero last acted: a seat
    that opened and is now answering a 3-bet is facing a 3-bet, not "a raise".
    """
    aggression = sum(1 for s in steps if s.action in AGGRESSIVE)
    if street == "preflop":
        if aggression == 0:
            return "limp" if any(s.action == "limp" for s in steps) else "none"
        return PREFLOP_FACING.get(aggression - 1, "5bet_plus")
    if aggression == 0:
        return "none"
    return POSTFLOP_FACING.get(aggression, "3bet")


def _last_aggressor(steps: list[ActionStep], hero: Position) -> Position | None:
    """The seat whose bet or raise hero is facing."""
    for step in reversed(steps):
        if step.position != hero and step.action in AGGRESSIVE:
            return step.position
    return None


def _bucket_leaf(dim: Dimension, low: float | None, high: float | None) -> Leaf:
    """One registry bucket as a `between` leaf; an open end is closed far beyond any value."""
    bottom = low if low is not None else 0.0
    top = high if high is not None else OPEN_ENDED
    return Leaf(dim=dim.code, op="between", value=[bottom, top])


def _bucket_of(value: float, dim: Dimension) -> Leaf:
    """The registry bucket `value` falls in, as a `between` leaf — never an exact float match."""
    for low, high in dim.buckets.values():
        bottom = low if low is not None else 0.0
        if value >= bottom and (high is None or value < high):
            return _bucket_leaf(dim, low, high)
    return Leaf(dim=dim.code, op="gte", value=0)


def _bucket_named(name: str, dim: Dimension) -> Leaf:
    """The registry bucket called `name`, as the same leaf `_bucket_of` builds from a value.

    The key carries the name and the registry the boundary, so no boundary is written twice
    (ADR-028); a name the registry does not know is an error, never an empty answer.
    """
    bounds = dim.buckets.get(name)
    if bounds is None:
        known = ", ".join(dim.buckets)
        raise RegistryError(f"unknown {dim.code} bucket {name!r}; the registry offers: {known}")
    return _bucket_leaf(dim, *bounds)


def _situation_leaves(key: NodeKey, reg: Registry) -> list[Node]:
    """The ADR-078 fields that are set: the pot's shape and the bet in front, by bucket."""
    leaves: list[Node] = []
    if key.pot_type is not None:
        leaves.append(Leaf(dim="pot_type", op="eq", value=key.pot_type))
    if key.size_bucket is not None:
        leaves.append(_bucket_named(key.size_bucket, reg.dimension(FACED_SIZE)))
    return leaves


def _texture_leaf(tag: str, reg: Registry) -> Leaf:
    """A board-texture tag is a value of one texture dimension; anything else is an error."""
    for code in TEXTURE_DIMENSIONS:
        dim = reg.dimensions.get(code)
        if dim is not None and tag in dim.values:
            return Leaf(dim=code, op="eq", value=tag)
    known = ", ".join(sorted(v for c in TEXTURE_DIMENSIONS for v in _values(c, reg) if v))
    raise RegistryError(f"unknown board texture {tag!r}; the texture dimensions offer: {known}")


def _texture_leaves(tags: Sequence[str], street: Street, reg: Registry) -> list[Leaf]:
    """One leaf per tag, each on the dimension that declares the tag as a value.

    Two things are refused here rather than becoming a query that matches no row and says
    nothing (ADR-078 gap 2): two different tags from one dimension (`["monotone", "rainbow"]`
    as two `eq` leaves under `All`), and a tag of a street the node has not reached (a
    `turn_blank` on a flop node, or any texture on a preflop one -- the column is '' there).
    The same tag twice is one leaf.
    """
    first_tag: dict[str, str] = {}
    out: list[Leaf] = []
    for tag in tags:
        leaf = _texture_leaf(tag, reg)
        set_on = TEXTURE_STREET[leaf.dim]
        if STREET_ORDER.index(street) < STREET_ORDER.index(set_on):
            raise RegistryError(
                f"board_texture: {tag!r} is a {leaf.dim} value, which is set from the "
                f"{set_on} on; this node is on the {street}"
            )
        earlier = first_tag.setdefault(leaf.dim, tag)
        if earlier == tag:
            if leaf not in out:
                out.append(leaf)
            continue
        raise RegistryError(
            f"board_texture: {earlier!r} and {tag!r} are both values of {leaf.dim!r}; "
            "a node carries one tag per dimension"
        )
    return out


def _values(code: str, reg: Registry) -> tuple[str, ...]:
    dim = reg.dimensions.get(code)
    return tuple(dim.values) if dim is not None else ()


def _villain_leaves(key: NodeKey, before: list[ActionStep]) -> list[Node]:
    """How the opponent is expressed — only ever in a way the decision fact can answer.

    The seat hero is facing is a column only when it is the seat that bet or raised
    (`last_raiser_position`), or preflop the seat that opened (`opener_position`). Anywhere
    else — a caller on the turn, say — naming the position would filter on a column that does
    not mean that, and the node would come back empty; what survives is whether hero has
    position on them, which is a column, and is the part that changes the decision.
    """
    villain = key.villain_position or _last_aggressor(before, key.hero_position)
    if villain is None:
        return []
    if _last_aggressor(before, key.hero_position) == villain:
        return [Leaf(dim="last_raiser_position", op="eq", value=villain)]
    if key.street == "preflop" and _first_raiser(before) == villain:
        return [Leaf(dim="opener_position", op="eq", value=villain)]
    if (
        key.street != "preflop"
        and villain in POSTFLOP_ORDER
        and key.hero_position in POSTFLOP_ORDER
    ):
        in_position = POSTFLOP_ORDER.index(key.hero_position) > POSTFLOP_ORDER.index(villain)
        return [Leaf(dim="is_ip", op="eq", value=int(in_position))]
    return []


def _first_raiser(steps: list[ActionStep]) -> Position | None:
    """The seat that opened the pot, if anyone has."""
    for step in steps:
        if step.action in AGGRESSIVE:
            return step.position
    return None


def node_filter(key: NodeKey, reg: Registry | None = None) -> Node:
    """The decisions this node covers. The key's **last step is excluded**: it is the answer.

    Raises `RegistryError` when the key names a texture the registry does not know, two
    textures from one dimension, a texture of a street the node has not reached, or a size
    bucket the registry does not have.
    """
    reg = reg or registry()
    before = list(key.action_sequence[:-1])
    leaves: list[Node] = [
        Leaf(dim="position", op="eq", value=key.hero_position),
        Leaf(dim="street", op="eq", value=key.street),
        Leaf(dim="facing", op="eq", value=_facing(before, key.street)),
        Leaf(dim="players_dealt_in", op="eq", value=key.table_size),
        _line_leaf(key, before),
    ]
    leaves.extend(_villain_leaves(key, before))

    stack = reg.dimensions.get("eff_stack_bb")
    if stack is not None and stack.buckets:
        leaves.append(_bucket_of(float(key.eff_stack_bb), stack))
    if key.stake:
        leaves.append(Leaf(dim="stake_level", op="eq", value=key.stake))
    leaves.extend(_situation_leaves(key, reg))
    leaves.extend(_texture_leaves(key.board_texture, key.street, reg))
    return All(all=leaves)
