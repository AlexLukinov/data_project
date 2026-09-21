"""The privacy guard: no real player's screen name in what this repository commits or pushes.

    make privacy-check                                     tracked and staged files
    make install-hooks                                     the local pre-push hook
    uv run python -m scripts.privacy_check --history REV   every blob in the commits REV reaches
    uv run python -m scripts.privacy_check --repo PATH     another repository, e.g. a scratch clone

"Only aggregates get committed" was a rule, and three lanes and two merges broke it without
noticing: a screen name in a test fixture or a verification note does not look like data. So the
rule is a check (ADR-058). Every real opponent's key is read from the real ClickHouse
(`core.hand_players`, read-only, never the `test_` databases); `scripts/privacy_match.py` matches
them over the texts `scripts/privacy_sources.py` yields. A finding prints the file, the line
number and the key -- never the line, never a stat. The pre-push hook runs the same check over
the commits a push would send (`--pre-push` reads git's own stdin); git does not version hooks,
so each clone installs it.

**It cannot run in CI**: CI has no real data, by design, so this is a local gate. `git push
--no-verify` skips it and checks nothing.

Exit status: 0 nothing found, 1 findings, 2 nothing could be checked.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import TextIO

from clickhouse_connect.driver.exceptions import ClickHouseError

from ingestion.clickhouse import clickhouse
from scripts.privacy_match import Matcher
from scripts.privacy_sources import (
    CheckError,
    Source,
    git,
    history,
    pushed_revs,
    tracked_and_staged,
)

ALLOWLIST = Path(__file__).resolve().parent / "privacy_allowlist.txt"
KEYS_SQL = """
SELECT DISTINCT assumeNotNull(player_key)
FROM core.hand_players
WHERE player_key IS NOT NULL AND is_hero = 0
  AND player_key NOT IN (
    SELECT assumeNotNull(player_key) FROM core.hand_players
    WHERE is_hero = 1 AND player_key IS NOT NULL
  )
"""
"""Every opponent's key in the real database. The hero's own names are not third-party data."""
HOOK = """#!/bin/sh
# The privacy guard (docs/POKER_DECISIONS.md ADR-058), installed by `make install-hooks`.
# Refuses a push that would send a real player's screen name. It reads the real ClickHouse,
# read-only, so the stack must be up. `git push --no-verify` skips it and checks nothing.
exec make --no-print-directory -s -C "$(git rev-parse --show-toplevel)/platform" \\
  privacy-check PRIVACY_ARGS="--pre-push $1"
"""


def real_player_keys() -> list[str]:
    """Every real opponent's `site:name` key, read-only from the real ClickHouse."""
    rows = clickhouse().query(KEYS_SQL, settings={"readonly": 1}).result_rows
    if not rows:
        raise CheckError("the real ClickHouse holds no player keys, so there is nothing to match")
    return [str(row[0]) for row in rows]


def allowlist(path: Path = ALLOWLIST) -> list[str]:
    """The ordinary words excused in other text: one per line, `#` starts a comment."""
    words = (line.split("#", 1)[0].strip() for line in path.read_text().splitlines())
    return [word for word in words if word]


def report(sources: Iterable[Source], matcher: Matcher, out: TextIO) -> int:
    """Print `path:line: key (context) [where]` per finding, once per file, line and key."""
    printed: set[tuple[str, int, str]] = set()
    for source in sources:
        for finding in matcher.scan(source.text):
            place = (source.path, finding.line, finding.key)
            if place not in printed:
                printed.add(place)
                where = f" [{source.where}]" if source.where else ""
                line = f"{source.path}:{finding.line}: {finding.key} ({finding.context}){where}"
                print(line, file=out)
    return len(printed)


def install_hook(repo: Path) -> str:
    """Write the pre-push hook into `repo`'s hooks directory; never replace a different one."""
    hooks = Path(git(repo, "rev-parse", "--git-path", "hooks").decode().strip())
    hook = (hooks if hooks.is_absolute() else repo / hooks) / "pre-push"
    if hook.exists():
        if hook.read_text() == HOOK:
            return f"already installed: {hook}"
        raise CheckError(f"{hook} already exists and is not this hook; merge the two by hand")
    hook.parent.mkdir(parents=True, exist_ok=True)
    hook.write_text(HOOK)
    hook.chmod(0o755)
    return f"installed: {hook}"


def _arguments(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--repo", type=Path, default=Path.cwd(), help="a path inside the repository")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--history", nargs="+", metavar="REV", help="git rev-list arguments")
    mode.add_argument("--pre-push", metavar="REMOTE", help="git's pre-push hook; reads stdin")
    mode.add_argument("--install-hook", action="store_true", help="write .git/hooks/pre-push")
    return ap.parse_args(argv)


def _sources(args: argparse.Namespace, repo: Path, stdin: TextIO) -> Iterable[Source]:
    if args.pre_push is not None:

        def has_commit(oid: str) -> bool:
            probe = ["git", "-C", str(repo), "cat-file", "-e", f"{oid}^{{commit}}"]
            return subprocess.run(probe, capture_output=True).returncode == 0

        revs = pushed_revs(args.pre_push, stdin, has_commit)
        return history(repo, revs) if revs else ()
    return history(repo, args.history) if args.history else tracked_and_staged(repo)


def main(
    argv: list[str] | None = None,
    *,
    keys: Callable[[], list[str]] = real_player_keys,
    stdin: TextIO = sys.stdin,
    out: TextIO = sys.stdout,
) -> int:
    """Run the check; the exit status (0 clean, 1 findings, 2 nothing could be checked)."""
    args = _arguments(argv)
    try:
        repo = Path(git(args.repo, "rev-parse", "--show-toplevel").decode().strip())
        if args.install_hook:
            print(install_hook(repo), file=out)
            return 0
        matcher = Matcher(keys(), allowlist())
        found = report(_sources(args, repo, stdin), matcher, out)
    except (CheckError, ClickHouseError, OSError, ValueError) as exc:
        print(f"privacy check: nothing was checked -- {exc}", file=sys.stderr)
        return 2
    return _summary(found, matcher, out)


def _summary(found: int, matcher: Matcher, out: TextIO) -> int:
    if matcher.unmatched_in_text:
        print(
            f"privacy check: {matcher.unmatched_in_text} real name(s) hold a character outside "
            "NAME_CHARS and were matched in hand-history lines and player keys only",
            file=out,
        )
    if found:
        print(
            f"privacy check: {found} place(s) hold a real player's key. Replace each name with an "
            "invented one and run the check again (docs/POKER_DECISIONS.md ADR-058).",
            file=out,
        )
        return 1
    print("privacy check: no real player key found", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
