"""`NodeKey` -> a filter over `marts.decisions` (ADR-028, plan F.8).

A node **is** a predicate: the decision rows where a seat in hero's position faces exactly what
the key's sequence puts in front of it. The key's last step is hero's own action, so it is not
part of the filter — it is the thing whose frequency the pool reports.

Everything here maps onto columns the decision fact already has (ADR-020); no new grammar and
no bucket boundary is written twice: `eff_stack_bb` is matched by the registry's own bucket.
"""

from __future__ import annotations

from analysis.pool.nodes import ActionStep, NodeKey, Position, Street
from stats.ast import All, Leaf, Node
from stats.definitions import Dimension
from stats.errors import RegistryError
from stats.registry import Registry, registry

LETTER: dict[str, str] = {
    "fold": "f",
    "check": "x",
    "limp": "l",
    "call": "c",
    "bet": "b",
    "raise": "r",
    "allin": "r",
}
"""The line alphabet of `dimensions.yaml`. An all-in is a raise as far as a line is concerned."""

AGGRESSIVE = frozenset({"bet", "raise", "allin"})

PREFLOP_FACING: dict[int, str] = {0: "raise", 1: "3bet", 2: "4bet"}
"""Raises in front -> `facing`, preflop. Three or more is `5bet_plus`."""

POSTFLOP_FACING: dict[int, str] = {1: "bet", 2: "raise"}
"""Bets and raises in front -> `facing`, postflop. Three or more is `3bet`."""

OPEN_ENDED = 1e9
"""Stands in for the open top of the last bucket; no stack, pot or size comes near it."""

TEXTURE_DIMENSIONS = ("flop_suitedness", "flop_pairing", "flop_connectedness", "flop_high_card")
"""Where a `board_texture` tag is looked up. A tag IS one of these dimensions' values."""

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


def _line_of(steps: list[ActionStep], hero: Position) -> str:
    """Hero's own actions, in the alphabet `dimensions.yaml` documents."""
    return "-".join(LETTER[s.action] for s in steps if s.position == hero)


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


def _bucket_of(value: float, dim: Dimension) -> Leaf:
    """The registry bucket `value` falls in, as a `between` leaf — never an exact float match."""
    for low, high in dim.buckets.values():
        bottom = low if low is not None else 0.0
        if value >= bottom and (high is None or value < high):
            top = high if high is not None else OPEN_ENDED
            return Leaf(dim=dim.code, op="between", value=[bottom, top])
    return Leaf(dim=dim.code, op="gte", value=0)


def _texture_leaf(tag: str, reg: Registry) -> Leaf:
    """A board-texture tag is a value of one of the flop dimensions; anything else is an error."""
    for code in TEXTURE_DIMENSIONS:
        dim = reg.dimensions.get(code)
        if dim is not None and tag in dim.values:
            return Leaf(dim=code, op="eq", value=tag)
    known = ", ".join(sorted(v for c in TEXTURE_DIMENSIONS for v in _values(c, reg) if v))
    raise RegistryError(f"unknown board texture {tag!r}; the flop dimensions offer: {known}")


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

    Raises `RegistryError` when the key names a texture the registry does not know.
    """
    reg = reg or registry()
    before = list(key.action_sequence[:-1])
    leaves: list[Node] = [
        Leaf(dim="position", op="eq", value=key.hero_position),
        Leaf(dim="street", op="eq", value=key.street),
        Leaf(dim="facing", op="eq", value=_facing(before, key.street)),
        Leaf(dim="players_dealt_in", op="eq", value=key.table_size),
    ]

    line_dim = "preflop_line" if key.street == "preflop" else "street_line"
    leaves.append(Leaf(dim=line_dim, op="eq", value=_line_of(before, key.hero_position)))

    leaves.extend(_villain_leaves(key, before))

    stack = reg.dimensions.get("eff_stack_bb")
    if stack is not None and stack.buckets:
        leaves.append(_bucket_of(float(key.eff_stack_bb), stack))
    if key.stake:
        leaves.append(Leaf(dim="stake_level", op="eq", value=key.stake))
    leaves.extend(_texture_leaf(tag, reg) for tag in key.board_texture)
    return All(all=leaves)
