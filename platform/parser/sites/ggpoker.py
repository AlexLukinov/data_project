"""GGPoker / PokerCraft parser — and the anonymization path.

GG's text export is PokerStars-derived, so the line grammar is reused wholesale. What is
*not* reused is player identity, and that is the architecturally important part:

**GG's own export anonymizes opponents; observed-pool exports do not.** Which one you are
holding is detected, never assumed — see `_anonymize` for why that distinction cost real data.

In an anonymized export every non-hero seat carries a **session-scoped** pseudonym. Measured
on a real 19,813-hand export: an alias recurs across roughly 2.8 tables (so it is NOT per-hand,
as this file previously claimed), but day-over-day overlap is 5-19% and **0 of 9,596 aliases
survived across 4+ chunk files**. So an alias is usable for "same villain, same session" and
worthless across sessions. Since Rush & Cash dissolves the table every hand, that window is
narrow enough that cross-hand opponent identity is effectively unavailable. The model handles
it by:

    player_key    = None        <- no cross-hand identity exists
    is_anonymized = 1
    anon_alias    = "1a2b3c4d"  <- kept for within-session grouping; never a player identity

Downstream, exactly one rule follows: opponent-level stats are gated on
`player_key IS NOT NULL`, in one place in the dbt intermediate layer. Hero stats work
normally on every site, and anonymous opponents still feed population baselines — you cannot
say "this villain folds too much", but you can say "the NL50 pool folds to a button steal 62%
of the time", which is what the AI coaching layer consumes anyway.

Validated against two real exports: a 19,813-hand personal Rush & Cash export (anonymized) and
a ~9.1M-hand observed-pool export (real names). GG has changed its export format before and
will again — the regression corpus in `seeds/hands/ggpoker/` is the guard.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

from core.enums import Site, TableFormat
from core.models import CanonicalHand
from parser.base import SNIFF_WINDOW_CHARS
from parser.errors import HandParseError
from parser.sites.pokerstars import PokerStarsParser

GG_HEADER = re.compile(r"^Poker\s+Hand\s+#(?P<hid>[A-Z]{0,3}\d+):")
HERO_ALIAS = "hero"
RUSH_TABLE = re.compile(r"Rush\s*(?:And|&)?\s*Cash", re.IGNORECASE)
PARSER_VERSION = 4
"""Re-parse marker. v2 corrected the blanket-anonymization bug; v3 corrected the alias regex
and made detection table-level; v4 added Cash Drop parsing, which rescued 56,872 hands the
validator had been correctly rejecting as unbalanced. Hands from an older version carry wrong
`player_key` values or are missing entirely — re-import with `WHERE parser_version < 4`."""

_HEX_ALIAS = re.compile(r"^[0-9a-f]{1,8}$")
"""GG aliases are a uint32 rendered with `%x` — leading zeros stripped, NOT zero-padded.

Measured over a 19,813-hand export, alias lengths were 8: 36,374 · 7: 2,250 · 6: 149 · 5: 3.
Those ratios are 1, 1/16, 1/256, 1/4096 to within a rounding error, which is exactly the
distribution of a uniformly random 32-bit integer printed as hex. An earlier `{8}` anchor
therefore missed 6.2% of aliases and leaked them downstream as though they were real,
trackable screen names."""

_SEAT_ALIAS = re.compile(r"^(?:Player|Seat|Villain)[ _]?\d+$", re.IGNORECASE)


def _looks_anonymous(name: str) -> bool:
    """True when a screen name has the shape of a machine-generated alias."""
    return bool(_HEX_ALIAS.match(name) or _SEAT_ALIAS.match(name))


class GGPokerParser(PokerStarsParser):
    """PokerStars grammar, GG identity rules."""

    site = Site.GGPOKER
    default_tz = "UTC"
    """GG stamps UTC and prints no abbreviation, unlike PokerStars' ET."""

    def matches(self, text: str) -> bool:
        """True when the text opens with a GG `Poker Hand #` header."""
        return bool(GG_HEADER.search(text[:SNIFF_WINDOW_CHARS]))

    def split(self, text: str) -> Iterator[str]:
        """Yield one hand at a time, splitting on the GG header."""
        lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        current: list[str] = []
        for line in lines:
            if GG_HEADER.match(line):
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

    def parse_hand(self, raw_text: str, hero_names: frozenset[str] | None = None) -> CanonicalHand:
        """Parse one GG hand, then apply the anonymization rules."""
        # Reuse the PokerStars machinery by normalizing the header keyword, then re-tag.
        normalized = self._to_stars_header(raw_text)
        hand = super().parse_hand(normalized, hero_names or frozenset({HERO_ALIAS}))
        hand.site = Site.GGPOKER
        hand.raw_text = raw_text
        hand.parser_version = PARSER_VERSION
        if RUSH_TABLE.search(hand.table_name):
            # Fast-fold: the table dissolves after every hand, so table identity carries no
            # continuity. Nothing downstream may assume table persistence.
            hand.table_format = TableFormat.RUSH
        self._anonymize(hand)
        return hand

    @staticmethod
    def _to_stars_header(raw_text: str) -> str:
        """Rewrite `Poker Hand #...` to `PokerStars Hand #...` so the shared grammar applies.

        A deliberate, contained hack: it keeps one implementation of the line grammar instead
        of two that drift. If GG's grammar ever diverges beyond the header, this class stops
        subclassing and gets its own `_consume`.
        """
        first, sep, rest = raw_text.partition("\n")
        if not GG_HEADER.match(first):
            raise HandParseError("no GGPoker hand header", raw_text, 1)
        return f"{first.replace('Poker Hand', 'PokerStars Hand', 1)}{sep}{rest}"

    @staticmethod
    def _anonymize(hand: CanonicalHand) -> None:
        """Strip cross-hand identity from anonymized seats — and ONLY those.

        **Detection is per TABLE, then per seat.** Two signals must agree before a name is
        discarded: the hand as a whole must look anonymized (at least half its non-hero seats
        carry alias-shaped names), and the individual name must be alias-shaped. Both real
        exports confirm this is the right split — a personal export anonymizes *every*
        opponent, and an observed-pool export anonymizes *none* — so a mixed hand is evidence
        of a misparse, not of a partly-anonymous table.

        Requiring both signals is what makes the short aliases safe to match. `[0-9a-f]{1,8}`
        alone would also match genuine screen names like `dead`, `cafe` or `beef`; requiring
        the rest of the table to agree means a real handle survives unless the whole table
        happens to be hex words. Conversely a real player literally named `Hero` cannot
        anonymize a table of real names on their own.

        History: v1 assumed every GG table anonymizes and nulled `player_key` unconditionally,
        destroying 881k real opponent identities in the population export. v2 detected per
        seat but anchored the alias regex at exactly 8 hex characters, leaking the 6.2% of
        aliases that render shorter (see `_HEX_ALIAS`).
        """
        others = [p for p in hand.players if not p.is_hero]
        if not others:
            return
        shaped = [p for p in others if _looks_anonymous(p.screen_name)]
        if len(shaped) * 2 < len(others):
            # A real-name table. A hex-looking handle here is somebody's actual screen name.
            return
        for player in shaped:
            player.is_anonymized = True
            player.anon_alias = player.screen_name
            player.player_key = None
