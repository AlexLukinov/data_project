"""PokerStars-format parser.

The reference format: several networks (WPN/ACR, GGPoker's PokerCraft export, and others)
approximate it, so getting this one right is leverage.

**Implementation style: a line-based state machine, not regex-per-line.** Every line is
classified once by cheap prefix/`in` checks and only then handed to a compiled regex. Naive
parsers run a dozen regexes against every line and land at 300-800 hands/sec/core; this
approach reaches the 1,500-5,000 range quoted in docs/POKER_DATA_MODEL.md §10. That is the
whole difference between "Python is fine" and "we need Rust".

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

import hashlib
import re
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal

from core.enums import (
    ActionType,
    GameType,
    LimitType,
    Site,
    Street,
    TableFormat,
    TournamentKind,
    TournamentSpeed,
)
from core.ids import player_key
from core.models import Action, CanonicalHand, HandPlayer, Pot, PotWinner, Tournament
from core.positions import assign_positions, preflop_order
from parser.base import SNIFF_WINDOW_CHARS, parse_money, to_utc
from parser.errors import HandParseError

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
# `.+` (greedy) and an end anchor, not `.+?`: screen names may contain brackets -- there is a
# in the corpus have names shaped like "Zorb[7]q", and a lazy match reads one as "Zorb" with
# with hole cards "4". GG also prints `Dealt to <name>` with NO cards for every seat.
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
PARSER_VERSION = 1


class PokerStarsParser:
    """Parse PokerStars-format text into `CanonicalHand`."""

    site = Site.POKERSTARS
    default_tz = "ET"
    """Timezone assumed when the header prints none. PokerStars stamps ET; other sites reusing
    this grammar override it. Whatever the file actually said is kept on `hand.tz_source`, so a
    wrong assumption is diagnosable instead of silently baked into every timestamp."""

    def matches(self, text: str) -> bool:
        """True when the text opens with a PokerStars hand header."""
        return bool(HEADER.search(text[:SNIFF_WINDOW_CHARS]))

    def split(self, text: str) -> Iterator[str]:
        """Yield one hand at a time from a multi-hand file.

        Splitting on the header rather than on blank lines: blank-line separation is a
        convention some exports break, while the header is structural.
        """
        lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        current: list[str] = []
        for line in lines:
            if HEADER.match(line):
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
        """Parse a single hand. Raises `HandParseError` on anything unusable."""
        lines = [ln.rstrip() for ln in raw_text.replace("\r\n", "\n").split("\n") if ln.strip()]
        if not lines:
            raise HandParseError("empty hand text", raw_text)

        hand = self._parse_header(lines[0], raw_text)
        state = _State(hand)

        for line_no, line in enumerate(lines[1:], start=2):
            try:
                self._consume(line, state)
            except HandParseError:
                raise
            except Exception as exc:
                raise HandParseError(f"{type(exc).__name__}: {exc}", raw_text, line_no) from exc

        self._finalize(state, hero_names)
        return state.hand

    # -- header ------------------------------------------------------------------

    def _parse_header(self, line: str, raw_text: str) -> CanonicalHand:
        match = HEADER.match(line)
        if not match:
            raise HandParseError("no PokerStars hand header", raw_text, 1)

        body = match.group("body")
        game_match = GAME.search(body)
        # An unrecognized variant is NOT fatal. Import the hand tagged UNKNOWN with the
        # printed name preserved, so a new game on a site is a follow-up task rather than a
        # rejected file. See GameType.UNKNOWN.
        game_type = GameType.UNKNOWN
        raw_game = ""
        if game_match:
            raw_game = game_match.group("game")
            game_type = GAME_BY_NAME.get(raw_game.lower(), GameType.UNKNOWN)

        stakes = STAKES.search(body)
        if not stakes:
            raise HandParseError(f"no stakes in header: {body!r}", raw_text, 1)

        tz = match.group("tz") or self.default_tz
        played_local = datetime.strptime(match.group("ts"), "%Y/%m/%d %H:%M:%S")
        tournament = self._parse_tournament(body)

        return CanonicalHand(
            # `self.site`, not a literal: subclasses reuse this grammar for their own network.
            site=self.site,
            site_hand_id=match.group("hid"),
            played_at_utc=to_utc(played_local, tz),
            played_at_local=played_local,
            tz_source=tz,
            game_type=game_type,
            # Stud and draw games often print no limit type (they are fixed-limit by
            # convention), so absence means FL rather than a parse failure.
            limit_type=LIMIT_BY_NAME.get(
                ((game_match.group("limit") if game_match else None) or "limit").lower(),
                LimitType.FL,
            ),
            table_format=self._table_format(body, tournament),
            currency=stakes.group("cur") or ("chips" if tournament else "USD"),
            small_blind=parse_money(stakes.group("sb")),
            big_blind=parse_money(stakes.group("bb")),
            max_seats=0,
            button_seat=0,
            tournament=tournament,
            raw_text=raw_text,
            parser_version=PARSER_VERSION,
            extra={"game_raw": raw_game} if game_type is GameType.UNKNOWN else {},
        )

    @staticmethod
    def _table_format(body: str, tournament: Tournament | None) -> TableFormat:
        """Distinguish MTT / SNG / Spin & Go / cash from the header text.

        Spin & Go and its clones are hyper-turbo 3-handed SNGs with a randomised prize pool;
        they behave so differently that lumping them in with MTTs makes both populations
        useless for comparison.
        """
        if tournament is None:
            return TableFormat.CASH
        lowered = body.lower()
        if "spin" in lowered or "blast" in lowered or "windfall" in lowered:
            return TableFormat.SPIN
        if "sit & go" in lowered or "sng" in lowered:
            return TableFormat.SNG
        return TableFormat.MTT

    @staticmethod
    def _parse_tournament(body: str) -> Tournament | None:
        """Extract full tournament context, or None for a cash hand.

        Covers freezeouts, rebuys, knockouts/PKO, satellites and shootouts at any speed and
        any table size — nothing here assumes 9-max or a fixed payout shape.
        """
        match = TOURNEY.search(body)
        if not match:
            return None

        buy_in = bounty = fee = Decimal(0)
        currency = "USD"
        amounts = BUYIN.search(body)
        if amounts:
            currency = amounts.group("cur") or "USD"
            if amounts.group("a3"):
                # Three parts => buy-in + bounty + fee. This IS the knockout signal.
                buy_in = parse_money(amounts.group("a1"))
                bounty = parse_money(amounts.group("a2"))
                fee = parse_money(amounts.group("a3"))
            else:
                buy_in = parse_money(amounts.group("a1"))
                fee = parse_money(amounts.group("a2"))

        kind_match = KIND.search(body)
        if kind_match:
            raw_kind = kind_match.group("kind").lower().replace(" ", "_").replace("__", "_")
            kind = {
                "progressive_knockout": TournamentKind.PROGRESSIVE_KO,
                "mystery_bounty": TournamentKind.PROGRESSIVE_KO,
                "knockout": TournamentKind.KNOCKOUT,
                "satellite": TournamentKind.SATELLITE,
                "rebuy": TournamentKind.REBUY,
                "shootout": TournamentKind.SHOOTOUT,
            }.get(raw_kind, TournamentKind.FREEZEOUT)
        elif bounty > 0:
            kind = TournamentKind.KNOCKOUT
        else:
            kind = TournamentKind.FREEZEOUT

        speed_match = SPEED.search(body)
        if speed_match:
            raw_speed = speed_match.group("speed").lower().replace(" ", "").replace("-", "")
            speed = {
                "hyperturbo": TournamentSpeed.HYPER,
                "turbo": TournamentSpeed.TURBO,
                "slow": TournamentSpeed.SLOW,
            }.get(raw_speed, TournamentSpeed.NORMAL)
        else:
            speed = TournamentSpeed.NORMAL

        level_match = LEVEL.search(body)
        return Tournament(
            tournament_id=match.group("tid"),
            kind=kind,
            speed=speed,
            buy_in=buy_in,
            bounty=bounty,
            fee=fee,
            currency=currency,
            level=level_match.group("level") if level_match else "",
            is_satellite=kind is TournamentKind.SATELLITE,
        )

    # -- body --------------------------------------------------------------------

    def _consume(self, line: str, state: _State) -> None:
        """Classify one line and apply it. Ordered by frequency: actions dominate.

        Anything unrecognized is RECORDED, never dropped. See `_State.unparsed`.
        """
        if line.startswith("***"):
            state.note_kind("street")
            self._street_marker(line, state)
            return
        if line.startswith("Seat ") and state.street is None:
            state.note_kind("seat")
            self._seat_line(line, state)
            return
        if line.startswith("Table "):
            state.note_kind("table")
            self._table_line(line, state)
            return
        if line.startswith("Dealt to "):
            state.note_kind("dealt")
            self._dealt_line(line, state)
            return
        if line.startswith("Uncalled bet"):
            state.note_kind("uncalled")
            self._uncalled_line(line, state)
            return
        if line.startswith("Total pot"):
            state.note_kind("total")
            self._total_pot_line(line, state)
            return
        if line.startswith("Cash Drop"):
            state.note_kind("cash_drop")
            self._cash_drop_line(line, state)
            return
        if line.startswith("Board "):
            state.note_kind("board")
            self._board_line(line, state)
            return
        if " collected " in line:
            state.note_kind("collected")
            self._collected_line(line, state)
            return
        if state.in_summary:
            state.note_kind("summary")
            return  # per-seat summary lines add nothing we haven't already captured
        if not self._action_line(line, state):
            # A line inside the action block that matched no known pattern. This is exactly
            # what a format change looks like on its first day.
            state.unparsed.append(line)

    def _table_line(self, line: str, state: _State) -> None:
        match = TABLE.match(line)
        if not match:
            return
        state.hand.table_name = match.group("name")
        state.hand.max_seats = int(match.group("max") or 0)
        state.hand.button_seat = int(match.group("btn"))

    def _seat_line(self, line: str, state: _State) -> None:
        match = SEAT.match(line)
        if not match:
            return
        name = match.group("name").strip()
        seat = int(match.group("seat"))
        state.hand.players.append(
            HandPlayer(
                seat=seat,
                screen_name=name,
                starting_stack=parse_money(match.group("stack")),
                player_key=player_key(self.site, name),
            )
        )
        state.seat_by_name[name] = seat

    def _street_marker(self, line: str, state: _State) -> None:
        match = STREET_MARK.match(line)
        if not match:
            return
        name = match.group("name").strip()
        if name == "SUMMARY":
            state.in_summary = True
            return
        street = STREET_BY_MARK.get(name)
        if street is None:
            return
        state.street = street
        # Do NOT reset per-street bet tracking when preflop "starts": the blinds were posted
        # BEFORE the *** HOLE CARDS *** marker and are already part of preflop's investment.
        # Resetting here made `raises $0.75 to $1.25` from the small blind add 1.25 instead of
        # 1.00 -- silently inflating every 3-bet sizing stat. The pot-math validator caught it.
        if street in (Street.FLOP, Street.TURN, Street.RIVER):
            state.reset_street()
        # Board cards arrive on the marker line. FLOP prints one bracket group; TURN and
        # RIVER print the previous board plus the new card, so the LAST group is the new one.
        groups = CARDS_IN_BRACKETS.findall(match.group("rest"))
        if not groups:
            return
        if street is Street.FLOP:
            state.hand.board = tuple(groups[0].split())
        elif street in (Street.TURN, Street.RIVER):
            state.hand.board = (*state.hand.board, *groups[-1].split())

    def _dealt_line(self, line: str, state: _State) -> None:
        match = DEALT.match(line)
        if not match:
            return
        name = match.group("name").strip()
        cards = match.group("cards")
        if not cards:
            # GG prints a card-less `Dealt to <name>` line for EVERY seat. Treating the first
            # of those as the hero picks an arbitrary opponent — only a seat whose cards we
            # can actually see identifies the exporting player.
            return
        state.dealt_cards[name] = tuple(cards.split())
        if state.dealt_first is None:
            state.dealt_first = name

    def _action_line(self, line: str, state: _State) -> bool:
        """Apply an action line. Returns False when nothing matched."""
        if ":" not in line:
            return False

        raise_match = ACT_RAISE.match(line)
        if raise_match:
            state.note_kind("raise")
            seat = state.seat_of(raise_match.group("name"))
            if seat is None:
                return True
            to_total = parse_money(raise_match.group("to"))
            # `raises X to Y`: Y is the player's total for the street, so the chips actually
            # added now are Y minus whatever they already had in on this street. Getting this
            # wrong is the classic parser bug, and pot-math validation catches it.
            added = to_total - state.street_invested.get(seat, Decimal(0))
            state.add_action(
                seat,
                ActionType.RAISE,
                amount=added,
                amount_to=to_total,
                is_allin=bool(raise_match.group("allin")),
            )
            return True

        post_match = ACT_POST.match(line)
        if post_match:
            state.note_kind("post")
            seat = state.seat_of(post_match.group("name"))
            if seat is None:
                return True
            action_type = POST_TO_ACTION.get(post_match.group("what"), ActionType.POST_DEAD)
            amount = parse_money(post_match.group("amt") or "")
            state.add_action(seat, action_type, amount=amount, amount_to=amount)
            if action_type is ActionType.POST_ANTE:
                state.hand.ante = max(state.hand.ante, amount)
            elif action_type is ActionType.POST_STRADDLE:
                state.hand.straddle = max(state.hand.straddle, amount)
            return True

        simple = ACT_SIMPLE.match(line)
        if simple:
            state.note_kind("action")
            seat = state.seat_of(simple.group("name"))
            if seat is None:
                return True
            action_type = VERB_TO_ACTION[simple.group("verb")]
            amount = parse_money(simple.group("amt") or "")
            state.add_action(
                seat,
                action_type,
                amount=amount,
                amount_to=state.street_invested.get(seat, Decimal(0)) + amount,
                is_allin=bool(simple.group("allin")),
            )
            return True

        cashout = ACT_CASHOUT.match(line)
        if cashout:
            state.note_kind("cashout")
            seat = state.seat_of(cashout.group("name"))
            if seat is not None and cashout.group("amt"):
                # Recorded on the player, not as a pot contribution: the cashout fee leaves
                # the player's stack without entering the pot, so adding it to `contributed`
                # would break the pot-math reconciliation it is not part of.
                player = state.hand.player_at(seat)
                if player is not None:
                    player.extra["cashout_risk"] = cashout.group("amt")
            return True

        show = ACT_SHOW.match(line)
        if show:
            state.note_kind("show")
            seat = state.seat_of(show.group("name"))
            if seat is None:
                return True
            cards = show.group("cards")
            if cards:
                state.dealt_cards.setdefault(show.group("name").strip(), tuple(cards.split()))
            is_show = show.group("verb") == "shows"
            state.add_action(seat, ActionType.SHOW if is_show else ActionType.MUCK)
            # Declining to show after everyone folded is NOT a showdown. Counting it as one
            # would inflate WTSD on every hand won without a call.
            if is_show or show.group("verb") == "mucks":
                state.showdown_seats.add(seat)
            return True

        return False

    def _uncalled_line(self, line: str, state: _State) -> None:
        match = UNCALLED.match(line)
        if not match:
            return
        seat = state.seat_of(match.group("name"))
        if seat is None:
            return
        state.add_action(seat, ActionType.UNCALLED_RETURN, amount=parse_money(match.group("amt")))

    def _collected_line(self, line: str, state: _State) -> None:
        match = COLLECTED.match(line)
        if not match:
            return
        seat = state.seat_of(match.group("name"))
        if seat is None:
            return
        label = match.group("pot")
        index = 0 if label in ("pot", "main pot") else _side_pot_index(label)
        state.hand.pot_winners.append(
            PotWinner(pot_index=index, seat=seat, amount_won=parse_money(match.group("amt")))
        )

    def _total_pot_line(self, line: str, state: _State) -> None:
        match = TOTAL_POT.match(line)
        if not match:
            return
        state.hand.total_pot = parse_money(match.group("pot"))
        rake_match = RAKE.search(line)
        state.hand.rake = parse_money(rake_match.group("rake") if rake_match else "")
        state.hand.jackpot_drop = sum((parse_money(v) for v in DROPS.findall(line)), Decimal(0))

    def _cash_drop_line(self, line: str, state: _State) -> None:
        """Record house-added money. Additive: some formats print more than one drop line."""
        match = CASH_DROP.match(line)
        if not match:
            return
        state.hand.cash_drop += parse_money(match.group("amt"))

    def _board_line(self, line: str, state: _State) -> None:
        match = BOARD.match(line)
        if match:
            state.hand.board = tuple(match.group("cards").split())

    # -- finalize ----------------------------------------------------------------

    def _finalize(self, state: _State, hero_names: frozenset[str] | None) -> None:
        """Fill in everything that can only be known once the whole hand has been read."""
        hand = state.hand
        if not hand.players:
            raise HandParseError("no seats parsed", hand.raw_text)

        seats = [p.seat for p in hand.players]
        positions = assign_positions(hand.button_seat, seats)
        order = preflop_order(hand.button_seat, seats)
        contributed = state.contributed
        awarded: dict[int, Decimal] = {}
        for winner in hand.pot_winners:
            awarded[winner.seat] = awarded.get(winner.seat, Decimal(0)) + winner.amount_won

        hero_seat = self._resolve_hero(state, hero_names)

        # "Saw the flop" means STILL LIVE when the flop was dealt -- not "acted on the flop".
        # The difference is all-in pots: when two players get it in preflop, both see all five
        # cards and neither acts again. Defining it by action undercounts WWSF and WTSD on
        # exactly the hands where the most money moved.
        reached = {
            Street.FLOP: len(hand.board) >= 3,
            Street.TURN: len(hand.board) >= 4,
            Street.RIVER: len(hand.board) >= 5,
        }

        # A player is live through a street if they never folded, or folded on a LATER street.
        def live_through(seat: int, street: Street) -> bool:
            folded_on = state.folded_on.get(seat)
            return folded_on is None or folded_on.order > street.order

        live_at_river = [
            p.seat
            for p in hand.players
            if reached[Street.RIVER] and live_through(p.seat, Street.RIVER)
        ]

        for player in hand.players:
            player.position = positions.get(player.seat, player.position)
            player.position_index = order.get(player.seat, 0)
            player.hole_cards = state.dealt_cards.get(player.screen_name, ())
            player.total_invested = contributed.get(player.seat, Decimal(0))
            player.net_won = awarded.get(player.seat, Decimal(0)) - player.total_invested
            player.saw_flop = reached[Street.FLOP] and live_through(player.seat, Street.PREFLOP)
            player.saw_turn = reached[Street.TURN] and live_through(player.seat, Street.FLOP)
            player.saw_river = reached[Street.RIVER] and live_through(player.seat, Street.TURN)
            # Showdown: an explicit show/muck, or still live at the river with company.
            # The second clause is what catches all-in run-outs, where nobody acts and some
            # sites print no show line for the loser.
            player.went_to_showdown = player.seat in state.showdown_seats or (
                player.seat in live_at_river and len(live_at_river) >= 2
            )
            player.won_hand = awarded.get(player.seat, Decimal(0)) > 0
            player.is_hero = player.seat == hero_seat

        hand.unparsed_lines = tuple(state.unparsed)
        # Fingerprint of the structural shape. Grouping stored hands by this turns "did the
        # site change their format?" into a query rather than a support ticket.
        hand.format_signature = hashlib.sha256(
            ("|".join(sorted(state.kinds))).encode()
        ).hexdigest()[:12]

        hand.hero_seat = hero_seat
        if not hand.max_seats:
            hand.max_seats = len(hand.players)
        if not hand.pots and hand.total_pot:
            hand.pots = [Pot(pot_index=0, amount=hand.total_pot, rake_share=hand.rake)]

    def _resolve_hero(self, state: _State, hero_names: frozenset[str] | None) -> int | None:
        """Decide which seat is the uploading user.

        Registered screen names win when supplied — they are authoritative. Otherwise fall
        back to the first `Dealt to` line, which in a self-exported history is the exporter.
        """
        if hero_names:
            for name, seat in state.seat_by_name.items():
                if name.lower() in hero_names:
                    return seat
        if state.dealt_first is not None:
            return state.seat_by_name.get(state.dealt_first)
        return None


def _side_pot_index(label: str) -> int:
    """Map `side pot` / `side pot-2` to a pot index (main pot is 0)."""
    if "-" in label:
        return int(label.rsplit("-", 1)[1])
    return 1


class _State:
    """Mutable accumulator for one hand being parsed.

    Kept as a plain class with explicit fields rather than a dict so a typo is an
    AttributeError instead of a silently missing value.
    """

    __slots__ = (
        "allin_seats",
        "contributed",
        "dealt_cards",
        "dealt_first",
        "folded_on",
        "hand",
        "in_summary",
        "kinds",
        "next_index",
        "pot",
        "seat_by_name",
        "seats_on",
        "showdown_seats",
        "street",
        "street_invested",
        "unparsed",
    )

    def __init__(self, hand: CanonicalHand) -> None:
        self.hand = hand
        self.street: Street | None = None
        self.in_summary = False
        self.next_index = 0
        self.pot = Decimal(0)
        self.seat_by_name: dict[str, int] = {}
        self.dealt_cards: dict[str, tuple[str, ...]] = {}
        self.dealt_first: str | None = None
        self.contributed: dict[int, Decimal] = {}
        self.street_invested: dict[int, Decimal] = {}
        self.showdown_seats: set[int] = set()
        self.allin_seats: set[int] = set()
        self.folded_on: dict[int, Street] = {}
        self.seats_on: dict[Street, set[int]] = {s: set() for s in Street}
        self.unparsed: list[str] = []
        self.kinds: set[str] = set()

    def note_kind(self, kind: str) -> None:
        """Record that a line of this kind appeared, for the format signature."""
        self.kinds.add(kind)

    def seat_of(self, raw_name: str) -> int | None:
        """Resolve a printed screen name to a seat number, or None if unseated."""
        return self.seat_by_name.get(raw_name.strip())

    def reset_street(self) -> None:
        """Clear per-street bet tracking when a new street begins."""
        self.street_invested = {}

    def add_action(
        self,
        seat: int,
        action_type: ActionType,
        *,
        amount: Decimal = Decimal(0),
        amount_to: Decimal = Decimal(0),
        is_allin: bool = False,
    ) -> None:
        """Append an action and update the running pot and per-seat totals."""
        street = self.street or Street.PREFLOP
        to_call = max(
            Decimal(0), self._max_street_bet() - self.street_invested.get(seat, Decimal(0))
        )
        self.hand.actions.append(
            Action(
                action_index=self.next_index,
                street=street,
                seat=seat,
                action_type=action_type,
                amount=amount,
                amount_to=amount_to,
                pot_before=self.pot,
                to_call=to_call,
                is_allin=is_allin,
            )
        )
        self.next_index += 1

        if action_type is ActionType.FOLD:
            self.folded_on[seat] = street
        if is_allin:
            self.allin_seats.add(seat)

        if action_type.puts_money_in:
            self.pot += amount
            self.contributed[seat] = self.contributed.get(seat, Decimal(0)) + amount
            self.street_invested[seat] = self.street_invested.get(seat, Decimal(0)) + amount
        elif action_type is ActionType.UNCALLED_RETURN:
            self.pot -= amount
            self.contributed[seat] = self.contributed.get(seat, Decimal(0)) - amount

        # A player "saw" a street if they took any action on it. Postflop that is exactly
        # right; preflop everyone dealt in is implied and handled separately.
        if street in (Street.FLOP, Street.TURN, Street.RIVER):
            self.seats_on[street].add(seat)
        if street is Street.SHOWDOWN:
            self.showdown_seats.add(seat)

    def _max_street_bet(self) -> Decimal:
        return max(self.street_invested.values(), default=Decimal(0))
