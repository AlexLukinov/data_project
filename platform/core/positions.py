"""Derive table positions from the button seat and which seats were dealt in.

Positions are **not in the hand-history file**. They are a function of (a) the button seat and
(b) the set of occupied seats, walked clockwise. Two traps this module exists to handle:

  * **Heads-up.** The button IS the small blind: it posts first preflop and acts LAST postflop.
    Naive "button, then small blind, then big blind" code produces three positions for two
    players.
  * **Short-handed tables.** Derive from seats actually dealt in, never from `max_seats` —
    a 6-max table with 4 players is a 4-handed hand, and calling the UTG seat "UTG" when
    there are only four players is wrong.

Position names are relative to the button, so they are assigned from the END of the clockwise
order backwards: the seat before the button is the cutoff, before that the hijack, and so on.
"""

from __future__ import annotations

from core.enums import Position

# Names for the non-blind seats, in order of preflop action (first to act -> button-adjacent),
# keyed by how many such seats there are.
#
# An explicit table rather than "walk backwards from the button and take names off a list":
# that approach names the first-to-act seat MP1 at a 6-handed table, when every tracker in the
# world calls it UTG. The naming genuinely differs by table size, so it is written out.
_NON_BLIND_POSITIONS: dict[int, tuple[Position, ...]] = {
    0: (),
    1: (Position.CO,),
    2: (Position.HJ, Position.CO),
    3: (Position.UTG, Position.HJ, Position.CO),
    4: (Position.UTG, Position.MP, Position.HJ, Position.CO),
    5: (Position.UTG, Position.UTG1, Position.MP, Position.HJ, Position.CO),
    6: (Position.UTG, Position.UTG1, Position.MP, Position.MP1, Position.HJ, Position.CO),
    7: (
        Position.UTG,
        Position.UTG1,
        Position.UTG2,
        Position.MP,
        Position.MP1,
        Position.HJ,
        Position.CO,
    ),
}


def clockwise_from(button_seat: int, occupied: list[int]) -> list[int]:
    """Return `occupied` reordered so it starts at the button and wraps clockwise.

    `occupied` need not contain `button_seat` (the button can sit on an empty seat when a
    player leaves mid-orbit); in that case the walk starts at the next occupied seat.
    """
    ordered = sorted(occupied)
    if not ordered:
        return []
    start = next((i for i, s in enumerate(ordered) if s >= button_seat), 0)
    return ordered[start:] + ordered[:start]


def assign_positions(button_seat: int, occupied: list[int]) -> dict[int, Position]:
    """Map each occupied seat to its position.

    Returns a dict keyed by seat number. `position_index` (order of first preflop action) is
    derived separately by `preflop_order`.
    """
    walk = clockwise_from(button_seat, occupied)
    n = len(walk)
    if n == 0:
        return {}
    if n == 1:
        return {walk[0]: Position.BTN}
    if n == 2:
        # Heads-up: button is the small blind. Only two names exist.
        return {walk[0]: Position.BTN, walk[1]: Position.BB}

    positions: dict[int, Position] = {
        walk[0]: Position.BTN,
        walk[1]: Position.SB,
        walk[2]: Position.BB,
    }
    # Remaining seats, in preflop action order: the seat after the big blind acts first.
    rest = walk[3:]
    names = _NON_BLIND_POSITIONS.get(len(rest))
    if names is None:  # more seats than any real table; degrade rather than crash
        names = tuple([Position.UNKNOWN] * (len(rest) - 7)) + _NON_BLIND_POSITIONS[7]
    for seat, name in zip(rest, names, strict=True):
        positions[seat] = name
    return positions


def preflop_order(button_seat: int, occupied: list[int]) -> dict[int, int]:
    """Map each seat to its preflop action order (0 = first to act).

    Preflop action starts left of the big blind — i.e. UTG — except heads-up, where the
    button/small blind acts first.
    """
    walk = clockwise_from(button_seat, occupied)
    n = len(walk)
    if n == 0:
        return {}
    if n == 2:
        return {walk[0]: 0, walk[1]: 1}
    # walk = [BTN, SB, BB, UTG, ...]; first to act preflop is index 3, wrapping.
    rotated = walk[3:] + walk[:3]
    return {seat: i for i, seat in enumerate(rotated)}
