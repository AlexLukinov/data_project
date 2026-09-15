"""Write the hot-path SQL derived from the dbt models (`make gen`), or check it (`--check`).

    uv run python -m scripts.gen_hot_path            # rewrite ch/hot_path/*.sql
    uv run python -m scripts.gen_hot_path --check    # exit 1 if any file differs (CI)

Generated (ADR-047), each carrying a `GENERATED` header and never edited by hand:
  ch/hot_path/decisions.sql       the worker's INSERT of one batch into marts.decisions
  ch/hot_path/player_hands.sql    the same into marts.player_hands

Both are the dbt models rendered with the batch predicate in place of the partition gate --
`scripts/hot_path_sql.py` says how -- so a change to a macro reaches the worker only through
`make gen`, and `make gen-check` refuses a tree where the two have come apart.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from scripts.hot_path_sql import MODELS, render_hot_path

PLATFORM = Path(__file__).resolve().parent.parent
HOT_PATH_DIR = PLATFORM / "ch" / "hot_path"


def expected_files(root: Path = HOT_PATH_DIR) -> dict[Path, str]:
    """Path -> content for every generated file."""
    return {root / f"{table}.sql": render_hot_path(table) for table in MODELS}


def main(argv: list[str] | None = None) -> int:
    """Write or check the generated files."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail instead of writing")
    args = ap.parse_args(argv)

    stale = []
    for path, content in expected_files().items():
        current = path.read_text() if path.exists() else None
        if current == content:
            continue
        stale.append(path)
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            print(f"wrote {path.relative_to(PLATFORM)}")

    if args.check and stale:
        names = ", ".join(p.name for p in stale)
        print(f"stale hot-path files: {names} -- run `make gen`", file=sys.stderr)
        return 1
    if not stale:
        print("hot-path files are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
