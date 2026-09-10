"""Enforce the size rules mechanically: functions <= 40 lines, files <= 300 lines.

    uv run python -m scripts.check_sizes                    # fail on violations not in the baseline
    uv run python -m scripts.check_sizes --update-baseline  # rewrite scripts/size_baseline.txt

The baseline lists violations that are known and scheduled (empty since plan C.6 deleted the
last two files on it). It is a burn-down list, not an exemption: an entry that no longer
violates FAILS the check too, so the baseline can only shrink. New violations fail
immediately (docs/POKER_AUDIT.md §5).
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

MAX_FUNCTION_LINES = 40
MAX_FILE_LINES = 300
PLATFORM = Path(__file__).resolve().parent.parent
BASELINE = PLATFORM / "scripts" / "size_baseline.txt"
CHECKED_DIRS = ("core", "parser", "ingestion", "stats", "analysis", "api", "ch", "scripts", "tests")


def _python_files() -> list[Path]:
    files: list[Path] = []
    for d in CHECKED_DIRS:
        files.extend(sorted((PLATFORM / d).rglob("*.py")))
    return files


def _function_lengths(path: Path, tree: ast.Module) -> list[tuple[str, int]]:
    """(qualified name, line count) for every function and method in the module."""
    found: list[tuple[str, int]] = []

    def visit(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
                name = f"{prefix}{child.name}"
                length = (child.end_lineno or child.lineno) - child.lineno + 1
                found.append((name, length))
                visit(child, f"{name}.")
            elif isinstance(child, ast.ClassDef):
                visit(child, f"{prefix}{child.name}.")

    visit(tree, "")
    return found


def violations() -> list[str]:
    """Every current violation, as `path` (file too long) or `path::function` (too long)."""
    out: list[str] = []
    for path in _python_files():
        rel = path.relative_to(PLATFORM).as_posix()
        source = path.read_text()
        if source.count("\n") + (0 if source.endswith("\n") else 1) > MAX_FILE_LINES:
            out.append(rel)
        tree = ast.parse(source, filename=rel)
        for name, length in _function_lengths(path, tree):
            if length > MAX_FUNCTION_LINES:
                out.append(f"{rel}::{name}")
    return out


def main(argv: list[str] | None = None) -> int:
    """Compare current violations with the baseline."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--update-baseline", action="store_true")
    args = ap.parse_args(argv)

    current = set(violations())
    if args.update_baseline:
        BASELINE.write_text("".join(f"{v}\n" for v in sorted(current)))
        print(f"baseline: {len(current)} entries")
        return 0

    baseline = set(BASELINE.read_text().split()) if BASELINE.exists() else set()
    new = sorted(current - baseline)
    fixed = sorted(baseline - current)
    for v in new:
        print(f"NEW size violation (>{MAX_FUNCTION_LINES} lines / >{MAX_FILE_LINES} lines): {v}")
    for v in fixed:
        print(f"baseline entry no longer violates -- remove it: {v}")
    if new or fixed:
        print("run `make size-baseline` after fixing or deliberately baselining", file=sys.stderr)
        return 1
    print(f"size check ok ({len(current)} baselined violations remain)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
