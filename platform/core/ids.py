"""Stable identifiers: hand deduplication keys and the solver-seam `spot_key`.

The dedup key is what makes re-uploading a file free and what lets an at-least-once Kafka
consumer be safe. It must be **deterministic** — the same hand parsed twice, by two parser
versions, on two machines, must produce the same `hand_uid`, or `ReplacingMergeTree` cannot
collapse the duplicate.
"""

from __future__ import annotations

import hashlib
import re

from core.enums import GameType, LimitType, Site

_UID_BYTES = 16
"""128 bits. Birthday collision risk at 10^11 hands is ~10^-16 — irrelevant."""

_WS = re.compile(r"\s+")


def hand_uid(site: Site, site_hand_id: str) -> str:
    """Deterministic dedup key for a hand.

    Site hand ids are unique *within* a site but collide across sites, so the site is part of
    the key. Use `content_uid` for sites that print no usable hand id.
    """
    digest = hashlib.sha256(f"{site.value}:{site_hand_id}".encode())
    return digest.hexdigest()[: _UID_BYTES * 2]


def content_uid(site: Site, raw_text: str) -> str:
    """Fallback dedup key derived from the hand text itself.

    Whitespace is collapsed first so that a re-export with different line endings or trailing
    spaces still hashes to the same value. Never use this when a real hand id exists — content
    hashing makes a hand that was legitimately re-dealt identically look like a duplicate.
    """
    normalized = _WS.sub(" ", raw_text).strip()
    digest = hashlib.sha256(f"{site.value}:{normalized}".encode())
    return digest.hexdigest()[: _UID_BYTES * 2]


def player_key(site: Site, screen_name: str) -> str:
    """Cross-hand identity for a player.

    Screen names are unique per site and NOT across sites, so the site is part of the key.
    Lower-cased because several networks are case-insensitive on login but inconsistent in
    hand histories.
    """
    return f"{site.value}:{screen_name.strip().lower()}"


def stake_bucket(limit_type: LimitType, big_blind_cents: int) -> str:
    """Coarse stake label used for grouping and for `spot_key`.

    Buckets, not exact stakes: NL48 and NL50 are the same population for analysis purposes,
    and exact-stake grouping fragments the sample past usefulness.
    """
    for edge in (2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000):
        if big_blind_cents <= edge:
            return f"{limit_type.value.upper()}{edge}"
    return f"{limit_type.value.upper()}5000+"


def spot_key(
    *,
    game_type: GameType,
    stake: str,
    hero_position: str,
    villain_position: str,
    street: str,
    action_sequence: str,
    stack_depth_bucket: str,
    board_texture: str = "",
) -> str:
    """Deterministic key for a strategic situation. **The solver / baseline seam.**

    This is the join key between a user's observed frequencies, population baselines, and
    (eventually) solver output. Anything that wants to be compared must bucket into the same
    `spot_key` space — see docs/POKER_DECISIONS.md ADR-011.

    Emitted from Phase 1 even though nothing joins against it yet: an unjoined column costs
    nothing, and retrofitting one costs a full reprocess of every hand.
    """
    parts = (
        game_type.value,
        stake,
        hero_position,
        villain_position,
        street,
        action_sequence,
        stack_depth_bucket,
        board_texture,
    )
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def stack_depth_bucket(effective_bb: float) -> str:
    """Bucket effective stack depth. Strategy is a function of depth, not of exact stack."""
    for edge, label in ((20, "0-20bb"), (40, "20-40bb"), (75, "40-75bb"), (150, "75-150bb")):
        if effective_bb <= edge:
            return label
    return "150bb+"
