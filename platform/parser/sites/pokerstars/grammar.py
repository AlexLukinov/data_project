"""The PokerStars line grammar: every regex and lookup table, and nothing else.

Compiled once at import. The parser classifies each line by a cheap prefix check first and
only then applies one of these -- that ordering, not regex cleverness, is what keeps the
parser in the 1,500-5,000 hands/sec/core range (docs/POKER_DATA_MODEL.md §10).
"""

from __future__ import annotations

import re

from core.enums import ActionType, GameType, LimitType, Street

HEADER = re.compile(
    # `hid` allows letters: GGPoker prefixes ids (RC…, TM…) and reuses this grammar.
    r"^PokerStars(?:\s+Zoom)?\s+Hand\s+#(?P<hid>[A-Za-z0-9]+):\s*"
    r"(?P<body>.*?)"
    r"\s-\s(?P<ts>\d{4}/\d{2}/\d{2}\s+\d{1,2}:\d{2}:\d{2})(?:\s+(?P<tz>[A-Z]{2,4}))?",
)
# Longest alternatives first: "Omaha Hi/Lo" must win over "Omaha", and "5 Card Omaha Hi/Lo"
# over both. Regex alternation is first-match, not longest-match.
GAME = re.compile(
    r"(?P<game>"
    r"6\+ Hold'em|Hold'em|"
    r"5 Card Omaha Hi/Lo|6 Card Omaha|5 Card Omaha|Courchevel|Omaha Hi/Lo|Omaha|"
    r"7 Card Stud Hi/Lo|7 Card Stud|Razz|"
    r"Triple Draw 2-7 Lowball|Single Draw 2-7 Lowball|5 Card Draw|Badugi|"
    r"All-in or Fold|Flipout|HORSE|8-Game|Mixed"
    r")(?:\s+(?P<limit>No Limit|Pot Limit|Fixed Limit|Limit))?",
    re.IGNORECASE,
)
STAKES = re.compile(
    r"\(\s*[^\d]*(?P<sb>[\d,.]+)/[^\d]*(?P<bb>[\d,.]+)(?:\s+(?P<cur>[A-Z]{3}))?\s*\)"
)
TABLE = re.compile(
    r"^Table\s+'(?P<name>.*)'\s+(?:(?P<max>\d+)-max\s+)?.*?Seat\s+#(?P<btn>\d+)\s+is\s+the\s+button"
)
SEAT = re.compile(
    r"^Seat\s+(?P<seat>\d+):\s+(?P<name>.+?)\s+\((?:[^\d]*)(?P<stack>[\d,.]+)\s+in\s+chips"
)
# `Seat 3: name (big blind) showed [Qd Js] and won ($6.08)` in the SUMMARY block. On an
# OBSERVED table -- which is what the pool corpus is -- this is the only place a villain's
# revealed cards are printed: the `Dealt to` line carries no cards for anyone, and there is
# no `: shows [..]` action line. Anchored on the seat number rather than the name, because
# the name is followed by an optional position parenthetical that is not part of it.
SEAT_SUMMARY = re.compile(
    r"^Seat\s+(?P<seat>\d+):\s+(?P<name>.+?)"
    r"(?:\s+\((?:button|small\s+blind|big\s+blind)\))?"
    r"\s+(?P<verb>showed|mucked)\s+\[(?P<cards>[^\[\]]+)\]"
)
# `.+` (greedy) and an end anchor, not `.+?`: screen names may contain brackets -- real players
# in the corpus have names shaped like "Zorb[7]q", and a lazy match reads one as "Zorb" with
# hole cards "7". GG also prints `Dealt to <name>` with NO cards for every seat.
DEALT = re.compile(r"^Dealt\s+to\s+(?P<name>.+?)(?:\s+\[(?P<cards>[^\[\]]+)\])?\s*$")
UNCALLED = re.compile(
    r"^Uncalled\s+bet\s+\((?:[^\d]*)(?P<amt>[\d,.]+)\)\s+returned\s+to\s+(?P<name>.+?)\s*$"
)
COLLECTED = re.compile(
    r"^(?P<name>.+?)\s+collected\s+(?:[^\d]*)(?P<amt>[\d,.]+)\s+from\s+"
    r"(?P<pot>main pot|side pot(?:-\d+)?|pot)"
)
# Two patterns, not one with an optional tail. A single regex anchored at `$` can never reach
# an optional group when the line continues past it -- and GG's line does:
#   Total pot $0.60 | Rake $0.03 | Jackpot $0.00 | Bingo $0 | Fortune $0 | Tax $0
# That silently returned rake=0 for 47% of real hands, every one of which then failed
# pot-math validation. Found only by running against a real 147k-hand export.
TOTAL_POT = re.compile(r"^Total\s+pot\s+(?:[^\d]*)(?P<pot>[\d,.]+)")
RAKE = re.compile(r"\bRake\s+(?:[^\d]*)(?P<rake>[\d,.]+)")
# Deductions that are NOT rake but still leave the pot. GG prints four of them; each is small
# and all four together are why 8% of real hands failed reconciliation after the rake fix.
DROPS = re.compile(r"\b(?:Jackpot|Bingo|Fortune|Tax)\s+(?:[^\d]*)([\d,.]+)")
CASH_DROP = re.compile(
    r"^Cash\s+Drop\s+to\s+Pot\s*:?\s*total\s+(?:[^\d]*)(?P<amt>[\d,.]+)", re.IGNORECASE
)
"""GG's Cash Drop promotion: `Cash Drop to Pot : total $2.50`.

The house ADDS this to the pot, so the winner collects more than the players contributed.
Every other money line in a hand history moves chips from players to the pot or back; this is
the only one that creates them, which is why it needs its own field rather than folding into
`jackpot_drop` (whose sign is the opposite). Left unparsed it broke pot reconciliation on
0.6% of a real 9M-hand corpus -- every one of which was then discarded by the validator."""
BOARD = re.compile(r"^Board\s+\[(?P<cards>[^\]]+)\]")
STREET_MARK = re.compile(r"^\*\*\*\s+(?P<name>[A-Z ]+?)\s+\*\*\*(?P<rest>.*)$")
CARDS_IN_BRACKETS = re.compile(r"\[([^\]]+)\]")
TOURNEY = re.compile(r"Tournament\s+#(?P<tid>\d+)")
# Buy-in components. PokerStars prints "$4.60+$4.60+$0.80" for a knockout (buy-in + bounty +
# fee) and "$9.20+$0.80" for a freezeout (buy-in + fee). The three-part form is how a bounty
# structure is detected when the header does not say "Knockout" anywhere.
BUYIN = re.compile(
    r"(?P<c1>[^\d\s]?)(?P<a1>[\d,.]+)\+(?P<c2>[^\d\s]?)(?P<a2>[\d,.]+)"
    r"(?:\+(?P<c3>[^\d\s]?)(?P<a3>[\d,.]+))?(?:\s+(?P<cur>[A-Z]{3}))?"
)
LEVEL = re.compile(r"Level\s+(?P<level>[IVXLC\d]+)")
SPEED = re.compile(r"\b(?P<speed>Hyper[- ]?Turbo|Turbo|Slow)\b", re.IGNORECASE)
KIND = re.compile(
    r"\b(?P<kind>Progressive\s+Knockout|Mystery\s+Bounty|Knockout|Satellite|Rebuy|Shootout)\b",
    re.IGNORECASE,
)

# Action lines. Split into two patterns because the raise form has an extra amount and
# matching it with an optional group makes the common cases pay for the rare one.
ACT_SIMPLE = re.compile(
    r"^(?P<name>.+?):\s+(?P<verb>folds|checks|calls|bets)"
    r"(?:\s+(?:[^\d]*)(?P<amt>[\d,.]+))?(?P<allin>\s+and\s+is\s+all-in)?\s*$"
)
ACT_RAISE = re.compile(
    r"^(?P<name>.+?):\s+raises\s+(?:[^\d]*)(?P<by>[\d,.]+)\s+to\s+(?:[^\d]*)(?P<to>[\d,.]+)"
    r"(?P<allin>\s+and\s+is\s+all-in)?\s*$"
)
ACT_POST = re.compile(
    r"^(?P<name>.+?):\s+posts\s+(?P<what>small blind|big blind|the ante|ante|"
    r"small & big blinds|straddle)\s*(?:[^\d]*)(?P<amt>[\d,.]+)?"
)
# "doesn't show hand" is the winner declining to reveal after everyone folded -- a muck, and
# a real line the drift detector caught on its first run because it matched nothing here.
# GGPoker EV Cashout: a player takes a settled EV price instead of running the board out.
# `Pays Cashout Risk` is the fee they pay for it -- real money, and it must not be counted as
# a bet. Recognised so it stops landing in `unparsed_lines`.
ACT_CASHOUT = re.compile(
    r"^(?P<name>.+?):\s+(?:Chooses\s+to\s+EV\s+Cashout"
    r"|Pays\s+Cashout\s+Risk\s*\((?:[^\d]*)(?P<amt>[\d,.]+)\))"
)
ACT_SHOW = re.compile(
    r"^(?P<name>.+?):\s+(?P<verb>shows|mucks|doesn't\s+show\s+hand|does\s+not\s+show\s+hand)"
    r"\s*(?:\[(?P<cards>[^\]]+)\])?"
)

STREET_BY_MARK: dict[str, Street] = {
    "HOLE CARDS": Street.PREFLOP,
    "FLOP": Street.FLOP,
    "TURN": Street.TURN,
    "RIVER": Street.RIVER,
    "SHOW DOWN": Street.SHOWDOWN,
    "SHOWDOWN": Street.SHOWDOWN,
}
GAME_BY_NAME: dict[str, GameType] = {
    "hold'em": GameType.HOLDEM,
    "6+ hold'em": GameType.SHORTDECK,
    "omaha": GameType.OMAHA,
    "omaha hi/lo": GameType.OMAHA_HI_LO,
    "5 card omaha": GameType.OMAHA5,
    "5 card omaha hi/lo": GameType.OMAHA5,
    "6 card omaha": GameType.OMAHA6,
    "courchevel": GameType.COURCHEVEL,
    "7 card stud": GameType.STUD,
    "7 card stud hi/lo": GameType.STUD_HI_LO,
    "razz": GameType.RAZZ,
    "5 card draw": GameType.DRAW5,
    "badugi": GameType.BADUGI,
    "triple draw 2-7 lowball": GameType.TRIPLE_DRAW_27,
    "single draw 2-7 lowball": GameType.SINGLE_DRAW_27,
    "all-in or fold": GameType.ALLIN_OR_FOLD,
    "flipout": GameType.FLIPOUT,
    "horse": GameType.HORSE,
    "8-game": GameType.EIGHT_GAME,
    "mixed": GameType.MIXED,
}
LIMIT_BY_NAME: dict[str, LimitType] = {
    "no limit": LimitType.NL,
    "pot limit": LimitType.PL,
    "fixed limit": LimitType.FL,
    "limit": LimitType.FL,
}
VERB_TO_ACTION: dict[str, ActionType] = {
    "folds": ActionType.FOLD,
    "checks": ActionType.CHECK,
    "calls": ActionType.CALL,
    "bets": ActionType.BET,
}
POST_TO_ACTION: dict[str, ActionType] = {
    "small blind": ActionType.POST_SB,
    "big blind": ActionType.POST_BB,
    "the ante": ActionType.POST_ANTE,
    "ante": ActionType.POST_ANTE,
    "small & big blinds": ActionType.POST_DEAD,
    "straddle": ActionType.POST_STRADDLE,
}
