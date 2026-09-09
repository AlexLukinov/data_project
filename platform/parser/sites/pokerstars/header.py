"""The header line: game, stakes, timestamp, and tournament context."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from core.enums import GameType, LimitType, Site, TableFormat, TournamentKind, TournamentSpeed
from core.models import CanonicalHand
from core.tournament import Tournament
from parser.base import parse_money, to_utc
from parser.errors import HandParseError
from parser.sites.pokerstars.grammar import (
    BUYIN,
    GAME,
    GAME_BY_NAME,
    HEADER,
    KIND,
    LEVEL,
    LIMIT_BY_NAME,
    SPEED,
    STAKES,
    TOURNEY,
)

KIND_BY_NAME: dict[str, TournamentKind] = {
    "progressive_knockout": TournamentKind.PROGRESSIVE_KO,
    "mystery_bounty": TournamentKind.PROGRESSIVE_KO,
    "knockout": TournamentKind.KNOCKOUT,
    "satellite": TournamentKind.SATELLITE,
    "rebuy": TournamentKind.REBUY,
    "shootout": TournamentKind.SHOOTOUT,
}
SPEED_BY_NAME: dict[str, TournamentSpeed] = {
    "hyperturbo": TournamentSpeed.HYPER,
    "turbo": TournamentSpeed.TURBO,
    "slow": TournamentSpeed.SLOW,
}


def parse_header(
    line: str, raw_text: str, *, site: Site, default_tz: str, parser_version: int
) -> CanonicalHand:
    """Build the hand skeleton from the first line. Raises `HandParseError` if it is not one."""
    match = HEADER.match(line)
    if not match:
        raise HandParseError("no PokerStars hand header", raw_text, 1)

    body = match.group("body")
    game_type, limit_type, raw_game = _game_and_limit(body)
    stakes = STAKES.search(body)
    if not stakes:
        raise HandParseError(f"no stakes in header: {body!r}", raw_text, 1)

    tz = match.group("tz") or default_tz
    played_local = datetime.strptime(match.group("ts"), "%Y/%m/%d %H:%M:%S")
    tournament = parse_tournament(body)

    return CanonicalHand(
        site=site,
        site_hand_id=match.group("hid"),
        played_at_utc=to_utc(played_local, tz),
        played_at_local=played_local,
        tz_source=tz,
        game_type=game_type,
        limit_type=limit_type,
        table_format=table_format(body, tournament),
        currency=stakes.group("cur") or ("chips" if tournament else "USD"),
        small_blind=parse_money(stakes.group("sb")),
        big_blind=parse_money(stakes.group("bb")),
        max_seats=0,
        button_seat=0,
        tournament=tournament,
        raw_text=raw_text,
        parser_version=parser_version,
        extra={"game_raw": raw_game} if game_type is GameType.UNKNOWN else {},
    )


def _game_and_limit(body: str) -> tuple[GameType, LimitType, str]:
    """(game, limit, printed game name).

    An unrecognized variant is NOT fatal: the hand imports tagged UNKNOWN with the printed
    name preserved, so a new game on a site is a follow-up task rather than a rejected file.
    Stud and draw games often print no limit type (fixed-limit by convention), so absence
    means FL rather than a parse failure.
    """
    game_match = GAME.search(body)
    if not game_match:
        return GameType.UNKNOWN, LimitType.FL, ""
    raw_game = game_match.group("game")
    game_type = GAME_BY_NAME.get(raw_game.lower(), GameType.UNKNOWN)
    limit = LIMIT_BY_NAME.get((game_match.group("limit") or "limit").lower(), LimitType.FL)
    return game_type, limit, raw_game


def table_format(body: str, tournament: Tournament | None) -> TableFormat:
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


def parse_tournament(body: str) -> Tournament | None:
    """Extract full tournament context, or None for a cash hand.

    Covers freezeouts, rebuys, knockouts/PKO, satellites and shootouts at any speed and
    any table size — nothing here assumes 9-max or a fixed payout shape.
    """
    match = TOURNEY.search(body)
    if not match:
        return None
    buy_in, bounty, fee, currency = _buy_in(body)
    kind = _kind(body, bounty)
    level_match = LEVEL.search(body)
    return Tournament(
        tournament_id=match.group("tid"),
        kind=kind,
        speed=_speed(body),
        buy_in=buy_in,
        bounty=bounty,
        fee=fee,
        currency=currency,
        level=level_match.group("level") if level_match else "",
        is_satellite=kind is TournamentKind.SATELLITE,
    )


def _buy_in(body: str) -> tuple[Decimal, Decimal, Decimal, str]:
    """(buy-in, bounty, fee, currency). Three amounts mean buy-in + bounty + fee."""
    amounts = BUYIN.search(body)
    if not amounts:
        return Decimal(0), Decimal(0), Decimal(0), "USD"
    currency = amounts.group("cur") or "USD"
    if amounts.group("a3"):
        # Three parts => buy-in + bounty + fee. This IS the knockout signal.
        return (
            parse_money(amounts.group("a1")),
            parse_money(amounts.group("a2")),
            parse_money(amounts.group("a3")),
            currency,
        )
    return parse_money(amounts.group("a1")), Decimal(0), parse_money(amounts.group("a2")), currency


def _kind(body: str, bounty: Decimal) -> TournamentKind:
    kind_match = KIND.search(body)
    if kind_match:
        raw = kind_match.group("kind").lower().replace(" ", "_").replace("__", "_")
        return KIND_BY_NAME.get(raw, TournamentKind.FREEZEOUT)
    return TournamentKind.KNOCKOUT if bounty > 0 else TournamentKind.FREEZEOUT


def _speed(body: str) -> TournamentSpeed:
    speed_match = SPEED.search(body)
    if not speed_match:
        return TournamentSpeed.NORMAL
    raw = speed_match.group("speed").lower().replace(" ", "").replace("-", "")
    return SPEED_BY_NAME.get(raw, TournamentSpeed.NORMAL)
