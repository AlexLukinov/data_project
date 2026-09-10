"""`NodeKey`: one situation, defined once (ADR-028; spec §10.1).

A node is a point where a seat has to act: the stake and table, the effective stack, hero's
seat, the seat hero is up against, the street, and the actions so far. **The action sequence
ends with hero's own action**, so a range stored at a node is "the combos that take the last
step": `UTG RFI` is `[UTG raise]`, `BB defend vs CO 2.5x` is `[CO raise 2.5, BB call]`. The
pool answers the same node with the last step removed -- what the field does *at* that point
-- and reads the last step as the action whose frequency it reports (F.8).

The TypeScript twin is `packages/poker-core/src/node.ts`; `tests/fixtures/nodes.json` is
parsed by both test suites so the two shapes cannot drift. `node_filter()` (NodeKey -> filter
AST over `marts.decisions`) arrives with F.8.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Position = Literal["UTG", "UTG1", "UTG2", "MP", "MP1", "HJ", "CO", "BTN", "SB", "BB"]
POSITIONS: tuple[Position, ...] = (
    "UTG",
    "UTG1",
    "UTG2",
    "MP",
    "MP1",
    "HJ",
    "CO",
    "BTN",
    "SB",
    "BB",
)
"""The registry's `position` vocabulary without UNKNOWN (`stats/registry/dimensions.yaml`)."""

Street = Literal["preflop", "flop", "turn", "river"]
NodeAction = Literal["fold", "check", "call", "bet", "raise", "limp", "allin"]

DEFAULT_TABLE_SIZE = 6
DEFAULT_STACK_BB = 100
MAX_SEQUENCE = 24
MAX_TEXTURE_TAGS = 8
MAX_STAKE_CHARS = 16

TextureTag = Annotated[str, StringConstraints(min_length=1, max_length=32)]


class ActionStep(BaseModel):
    """One action in the sequence.

    `size_bb` is a preflop raise-to in big blinds; `size_pct` a postflop bet or raise as a
    fraction of the pot. Both optional: a chart named `BTN 3bet` has no size.
    """

    model_config = ConfigDict(extra="forbid")

    position: Position
    action: NodeAction
    size_bb: float | None = Field(default=None, gt=0)
    size_pct: float | None = Field(default=None, gt=0)


class NodeKey(BaseModel):
    """A situation.

    Every field but hero's seat has a default, so a key inferred from a filename such as
    `UTG_RFI` validates and can be refined in the review table. `extra="forbid"` catches the
    camelCase spelling of the spec's draft (`heroPosition`) instead of silently ignoring it.
    """

    model_config = ConfigDict(extra="forbid")

    stake: str = Field(default="", max_length=MAX_STAKE_CHARS)
    table_size: int = Field(default=DEFAULT_TABLE_SIZE, ge=2, le=10)
    eff_stack_bb: int = Field(default=DEFAULT_STACK_BB, ge=1, le=10_000)
    hero_position: Position
    villain_position: Position | None = None
    action_sequence: list[ActionStep] = Field(default_factory=list, max_length=MAX_SEQUENCE)
    street: Street = "preflop"
    board_texture: list[TextureTag] = Field(default_factory=list, max_length=MAX_TEXTURE_TAGS)

    def canonical(self) -> dict[str, object]:
        """The JSON stored in `ranges.node_key` and compared on lookup: every field present."""
        return self.model_dump(mode="json")
