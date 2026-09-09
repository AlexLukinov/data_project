"""Write the dbt staging models from `core/schema` (`make gen`), or check them (`--check`).

uv run python -m scripts.gen_schema            # rewrite dbt/poker_dwh/models/staging/stg_*.sql
uv run python -m scripts.gen_schema --check    # exit 1 if any file differs (CI)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from core.schema import STAGING_MODULES, TABLES
from core.schema.staging import render_staging_model

STAGING_DIR = Path(__file__).resolve().parent.parent / "dbt" / "poker_dwh" / "models" / "staging"


def expected_files() -> dict[Path, str]:
    """Path -> content for every generated staging model."""
    return {
        STAGING_DIR / f"stg_{spec.name}.sql": render_staging_model(spec, STAGING_MODULES[spec.name])
        for spec in TABLES
    }


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
            path.write_text(content)
            print(f"wrote {path.relative_to(STAGING_DIR.parents[2])}")

    if args.check and stale:
        names = ", ".join(p.name for p in stale)
        print(f"stale generated files: {names} -- run `make gen`", file=sys.stderr)
        return 1
    if not stale:
        print("generated staging models are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
