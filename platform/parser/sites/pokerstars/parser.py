"""PokerStars-format parser: the class that ties grammar, state, line handlers and finalize.

The reference format: several networks (WPN/ACR, GGPoker's PokerCraft export, and others)
approximate it, so getting this one right is leverage.

**Implementation style: a line-based state machine, not regex-per-line.** Every line is
classified once by cheap prefix/`in` checks (`DISPATCH` below) and only then handed to a
compiled regex. Naive parsers run a dozen regexes against every line and land at 300-800
hands/sec/core; this approach reaches the 1,500-5,000 range quoted in
docs/POKER_DATA_MODEL.md §10. That is the whole difference between "Python is fine" and "we
need Rust".

Structure of a hand:

    PokerStars Hand #245...:  Hold'em No Limit ($0.25/$0.50 USD) - 2026/01/15 10:23:45 ET
    Table 'Aludra II' 6-max Seat #3 is the button
    Seat 1: Hero ($50.00 in chips)              <- seat block
    Villain3: posts small blind $0.25           <- blinds
    *** HOLE CARDS ***
    Dealt to Hero [Ac Kd]                       <- identifies the exporting player
    Hero: raises $1.00 to $1.50                 <- action lines
    *** FLOP *** [Ah 7c 2d]
    ...
    Uncalled bet ($5.50) returned to Hero
    Hero collected $6.60 from pot
    *** SUMMARY ***
    Total pot $7.25 | Rake $0.65
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator

from core.enums import Site
from core.models import CanonicalHand
from parser.base import SNIFF_WINDOW_CHARS
from parser.errors import HandParseError
from parser.sites.pokerstars import lines
from parser.sites.pokerstars.finalize import finalize
from parser.sites.pokerstars.grammar import HEADER
from parser.sites.pokerstars.header import parse_header
from parser.sites.pokerstars.state import HandState

PARSER_VERSION = 1

Predicate = Callable[[str, HandState], bool]
Handler = Callable[[str, HandState], None]

# Ordered by frequency and specificity. The first predicate that matches wins; the line's
# kind is noted for the format signature and the handler applies it.
DISPATCH: tuple[tuple[Predicate, str, Handler], ...] = (
    (lambda line, _: line.startswith("***"), "street", lines.street_marker),
    (lambda line, s: line.startswith("Seat ") and s.street is None, "seat", lines.seat_line),
    (lambda line, _: line.startswith("Table "), "table", lines.table_line),
    (lambda line, _: line.startswith("Dealt to "), "dealt", lines.dealt_line),
    (lambda line, _: line.startswith("Uncalled bet"), "uncalled", lines.uncalled_line),
    (lambda line, _: line.startswith("Total pot"), "total", lines.total_pot_line),
    (lambda line, _: line.startswith("Cash Drop"), "cash_drop", lines.cash_drop_line),
    (lambda line, _: line.startswith("Board "), "board", lines.board_line),
    (lambda line, _: " collected " in line, "collected", lines.collected_line),
)


def split_on(header: re.Pattern[str], text: str) -> Iterator[str]:
    """Yield one hand at a time from a multi-hand file, splitting on `header` matches.

    Splitting on the header rather than on blank lines: blank-line separation is a
    convention some exports break, while the header is structural. Shared with the GG
    parser, which has its own header pattern.
    """
    current: list[str] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if header.match(line):
            if current:
                chunk = "\n".join(current).strip()
                if chunk:
                    yield chunk
            current = [line]
        elif current:
            current.append(line)
    if current:
        chunk = "\n".join(current).strip()
        if chunk:
            yield chunk


class PokerStarsParser:
    """Parse PokerStars-format text into `CanonicalHand`."""

    site = Site.POKERSTARS
    default_tz = "ET"
    """Timezone assumed when the header prints none. PokerStars stamps ET; other sites reusing
    this grammar override it. Whatever the file actually said is kept on `hand.tz_source`, so a
    wrong assumption is diagnosable instead of silently baked into every timestamp."""
    parser_version = PARSER_VERSION

    def matches(self, text: str) -> bool:
        """True when the text opens with a PokerStars hand header."""
        return bool(HEADER.search(text[:SNIFF_WINDOW_CHARS]))

    def split(self, text: str) -> Iterator[str]:
        """Yield one hand at a time from a multi-hand file."""
        return split_on(HEADER, text)

    def parse_hand(self, raw_text: str, hero_names: frozenset[str] | None = None) -> CanonicalHand:
        """Parse a single hand. Raises `HandParseError` on anything unusable."""
        text_lines = [
            ln.rstrip() for ln in raw_text.replace("\r\n", "\n").split("\n") if ln.strip()
        ]
        if not text_lines:
            raise HandParseError("empty hand text", raw_text)

        # `self.site`, not a literal: subclasses reuse this grammar for their own network.
        hand = parse_header(
            text_lines[0],
            raw_text,
            site=self.site,
            default_tz=self.default_tz,
            parser_version=self.parser_version,
        )
        state = HandState(hand)
        for line_no, line in enumerate(text_lines[1:], start=2):
            try:
                self._consume(line, state)
            except HandParseError:
                raise
            except Exception as exc:
                raise HandParseError(f"{type(exc).__name__}: {exc}", raw_text, line_no) from exc

        finalize(state, hero_names)
        return state.hand

    def _consume(self, line: str, state: HandState) -> None:
        """Classify one line and apply it. Anything unrecognized is RECORDED, never dropped."""
        for predicate, kind, handler in DISPATCH:
            if predicate(line, state):
                state.note_kind(kind)
                handler(line, state)
                return
        if state.in_summary:
            state.note_kind("summary")
            return  # per-seat summary lines add nothing we haven't already captured
        if not lines.action_line(line, state):
            # A line inside the action block that matched no known pattern. This is exactly
            # what a format change looks like on its first day.
            state.unparsed.append(line)
