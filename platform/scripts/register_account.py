"""Bind a poker screen name to an account, so the parser can resolve which seat is hero.

Without at least one registered name the parser falls back to the `Dealt to <name> [cards]`
line. That works for GG's own exports and fails for everything else — observed hands, formats
that omit the line, and any file where the hero mucked. Registering the name makes hero
resolution explicit instead of inferred.

Usage:
    uv run python -m scripts.register_account --email you@example.com --screen-name Hero
    uv run python -m scripts.register_account --email you@example.com --list
"""

from __future__ import annotations

import argparse
import sys
import uuid

import psycopg

from core.enums import Site
from core.settings import get_settings


def _register(
    conn: psycopg.Connection[tuple[object, ...]], user_id: object, site: str, name: str
) -> None:
    """Insert the (site, screen name) pair unless it is already there."""
    existing = conn.execute(
        "SELECT 1 FROM poker_accounts WHERE user_id = %s AND site = %s AND screen_name = %s",
        (user_id, site, name),
    ).fetchone()
    if existing:
        print(f"already registered: {name!r} on {site}")
        return
    conn.execute(
        "INSERT INTO poker_accounts (id, user_id, site, screen_name, is_verified, "
        "created_at, updated_at) VALUES (%s, %s, %s, %s, false, now(), now())",
        (str(uuid.uuid4()), user_id, site, name),
    )
    print(f"registered {name!r} on {site}")


def _print_names(conn: psycopg.Connection[tuple[object, ...]], user_id: object, email: str) -> None:
    """List every screen name bound to the account."""
    rows = conn.execute(
        "SELECT site, screen_name FROM poker_accounts WHERE user_id = %s "
        "ORDER BY site, screen_name",
        (user_id,),
    ).fetchall()
    print(f"\nscreen names for {email}:")
    for site, name in rows:
        print(f"  {site:12s} {name}")
    if not rows:
        print("  (none)")


def main(argv: list[str] | None = None) -> int:
    """Add or list the screen names bound to one account."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", required=True)
    ap.add_argument("--screen-name")
    ap.add_argument("--site", default=Site.GGPOKER.value)
    ap.add_argument("--list", action="store_true", help="show what is registered and exit")
    args = ap.parse_args(argv)

    if not args.list and not args.screen_name:
        ap.error("either --screen-name or --list is required")

    dsn = get_settings().postgres_libpq_dsn
    with psycopg.connect(dsn, autocommit=True) as conn:
        row = conn.execute("SELECT id FROM users WHERE email = %s", (args.email,)).fetchone()
        if row is None:
            print(f"no user with email {args.email!r}", file=sys.stderr)
            return 1
        user_id = row[0]
        if args.screen_name:
            _register(conn, user_id, args.site, args.screen_name)
        _print_names(conn, user_id, args.email)
    return 0


if __name__ == "__main__":
    sys.exit(main())
