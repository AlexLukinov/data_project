"""`NodeKey`: one situation, defined once (ADR-028, ADR-078; spec §10.1).

A node is a point where a seat has to act: the stake and table, the effective stack, hero's
seat, the seat hero is up against, the street, and the actions so far. **The action sequence
ends with hero's own action**, so a range stored at a node is "the combos that take the last
step": `UTG RFI` is `[UTG raise]`, `BB defend vs CO 2.5x` is `[CO raise 2.5, BB call]`. The
pool answers the same node with the last step removed -- what the field does *at* that point
-- and reads the last step as the action whose frequency it reports (F.8).

The sequence carries **this street only** (the `hand/node.ts` convention). What happened on
the earlier streets is `line_so_far`, hero's own actions street by street in the registry's
line alphabet (`'r/b/b/'`: opened, bet the flop, bet the turn, deciding on the river). Its
last segment is this street's own actions so far, which the sequence already says, so the two
must agree -- a key never carries two accounts of one street. `size_bucket` names the registry
bucket the bet in front of hero falls in, and `pot_type` how the pot was built preflop (ADR-078).

The TypeScript twin is `packages/poker-core/src/node.ts`; `tests/fixtures/nodes.json` is
parsed by both test suites so the two shapes cannot drift. `node_filter()` turns a key into
a filter AST over `marts.decisions`.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

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
STREETS: tuple[Street, ...] = ("preflop", "flop", "turn", "river")
NodeAction = Literal["fold", "check", "call", "bet", "raise", "limp", "allin"]

PotType = Literal["limped", "srp", "3bet", "4bet", "5bet_plus"]
POT_TYPES: tuple[PotType, ...] = ("limped", "srp", "3bet", "4bet", "5bet_plus")
"""The registry's `pot_type` values, pinned to it by `tests/test_nodes.py`."""

SizeBucket = Literal["small", "mid", "large", "pot", "overbet"]
SIZE_BUCKETS: tuple[SizeBucket, ...] = ("small", "mid", "large", "pot", "overbet")
"""The registry's `facing_size_pct` bucket names, pinned to it by `tests/test_nodes.py`.

Only the names live here. The boundaries are the registry's, and `node_filter` reads them
from it (ADR-028): no boundary is written twice.
"""

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

DEFAULT_TABLE_SIZE = 6
DEFAULT_STACK_BB = 100
MAX_SEQUENCE = 24
MAX_TEXTURE_TAGS = 8
MAX_STAKE_CHARS = 16
MAX_LINE_CHARS = 64
STREET_SEP = "/"
ACTION_SEP = "-"
LINE_PATTERN = r"^(?:[fxlcbr](?:-[fxlcbr])*)?(?:/(?:[fxlcbr](?:-[fxlcbr])*)?)*$"
"""Letters joined by `-` within a street, streets joined by `/`; `''` and `'r/'` both fit."""

TextureTag = Annotated[str, StringConstraints(min_length=1, max_length=32)]
LineSoFar = Annotated[str, StringConstraints(max_length=MAX_LINE_CHARS, pattern=LINE_PATTERN)]


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


def own_line(steps: list[ActionStep], hero: Position) -> str:
    """Hero's own actions among `steps`, in the alphabet `dimensions.yaml` documents."""
    return ACTION_SEP.join(LETTER[s.action] for s in steps if s.position == hero)


class NodeKey(BaseModel):
    """A situation.

    Every field but hero's seat has a default, so a key inferred from a filename such as
    `UTG_RFI` validates and can be refined in the review table. `extra="forbid"` catches the
    camelCase spelling of the spec's draft (`heroPosition`) instead of silently ignoring it.

    The three ADR-078 fields default to "not part of this situation": a key without them is
    the single-street node it always was, and a key stored before they existed reads back
    unchanged (the migration `b9c0d1e2f3a4` wrote these defaults into every stored key).
    """

    model_config = ConfigDict(extra="forbid")

    stake: str = Field(default="", max_length=MAX_STAKE_CHARS)
    table_size: int = Field(default=DEFAULT_TABLE_SIZE, ge=2, le=10)
    eff_stack_bb: int = Field(default=DEFAULT_STACK_BB, ge=1, le=10_000)
    hero_position: Position
    villain_position: Position | None = None
    action_sequence: list[ActionStep] = Field(default_factory=list, max_length=MAX_SEQUENCE)
    street: Street = "preflop"
    line_so_far: LineSoFar | None = None
    """Hero's own line across streets, `'r/x-c/'` style; one segment per street up to this one.

    Postflop only: preflop there is no earlier street, and the sequence is the whole line.
    """
    size_bucket: SizeBucket | None = None
    """The registry bucket of the bet hero is facing, as a fraction of the pot; postflop only.

    A preflop size is a raise-to in big blinds and lives on the step (`size_bb`); the decision
    fact has no faced-raise-to column to bucket it by, so a preflop key refuses this field
    rather than filter on `facing_size_pct`, which preflop is a raise over the blinds.
    """
    pot_type: PotType | None = None
    board_texture: list[TextureTag] = Field(default_factory=list, max_length=MAX_TEXTURE_TAGS)

    @model_validator(mode="after")
    def _one_account_of_this_street(self) -> NodeKey:
        """`line_so_far` is postflop, reaches exactly this street and ends as the sequence says.

        Preflop the sequence *is* the whole line, so a line there would be a second spelling of
        one situation (`''` beside `null`), and lookup compares spellings (ADR-031).
        """
        if self.line_so_far is None:
            return self
        if self.street == "preflop":
            raise ValueError(
                "line_so_far is postflop only: a preflop key's sequence is its whole line"
            )
        streets = self.line_so_far.count(STREET_SEP)
        if streets != STREETS.index(self.street):
            raise ValueError(
                f"line_so_far {self.line_so_far!r} has {streets + 1} street(s) but the key is on "
                f"the {self.street} (needs {STREETS.index(self.street) + 1})"
            )
        this_street = self.line_so_far.rsplit(STREET_SEP, 1)[-1]
        from_sequence = own_line(self.action_sequence[:-1], self.hero_position)
        if this_street != from_sequence:
            raise ValueError(
                f"line_so_far ends in {this_street!r} but the sequence says hero's line this "
                f"street is {from_sequence!r}; a key carries one account of a street"
            )
        return self

    @model_validator(mode="after")
    def _a_size_bucket_is_postflop(self) -> NodeKey:
        if self.size_bucket is not None and self.street == "preflop":
            raise ValueError(
                "size_bucket is a fraction of the pot and postflop only; a preflop size is a "
                "raise-to in big blinds on the step (size_bb)"
            )
        return self

    def canonical(self) -> dict[str, object]:
        """The JSON stored in `ranges.node_key` and compared on lookup: every field present."""
        return self.model_dump(mode="json")
