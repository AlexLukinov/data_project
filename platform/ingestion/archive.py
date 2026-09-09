"""Walk hand-history archives: directories, text files, and zips of zips.

Nested zips are the normal case, not an edge case: PokerCraft exports a zip per day and then
a zip of those zips for a date range. Reading them in memory avoids writing 11GB of
intermediate text to disk just to read it back once.
"""

from __future__ import annotations

import io
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

TEXT_SUFFIXES = (".txt",)


@dataclass(slots=True, frozen=True)
class SourceFile:
    """One unit of work: a named blob of hand text, wherever it came from."""

    label: str
    """Human-readable provenance, e.g. `outer.zip!2025-01-06.zip!hhd_RushCash.txt`."""

    data: bytes


def walk_sources(path: Path) -> Iterator[SourceFile]:
    """Yield every hand-text blob under `path`, descending into nested zips."""
    if path.is_dir():
        for child in sorted(path.rglob("*")):
            if child.is_file() and child.suffix.lower() in TEXT_SUFFIXES:
                yield SourceFile(str(child), child.read_bytes())
        return

    if path.suffix.lower() == ".zip":
        yield from walk_zip(zipfile.ZipFile(path), str(path))
        return

    yield SourceFile(str(path), path.read_bytes())


def walk_zip(archive: zipfile.ZipFile, prefix: str) -> Iterator[SourceFile]:
    """Recurse through one zip, yielding text members and descending into inner zips."""
    for info in sorted(archive.infolist(), key=lambda i: i.filename):
        if info.is_dir():
            continue
        name = info.filename
        lowered = name.lower()
        if lowered.endswith(".zip"):
            inner = zipfile.ZipFile(io.BytesIO(archive.read(info)))
            yield from walk_zip(inner, f"{prefix}!{name}")
        elif lowered.endswith(TEXT_SUFFIXES):
            yield SourceFile(f"{prefix}!{name}", archive.read(info))
