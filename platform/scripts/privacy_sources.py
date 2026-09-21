"""Where the privacy guard's text comes from: the working tree, the index, git's objects.

Each source yields `Source` texts for `scripts.privacy_match` to scan. Nothing here knows what a
screen name is; `scripts/privacy_check.py` owns the keys, the report and the hook (ADR-058).
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path


class CheckError(Exception):
    """Nothing could be checked; the sentence says why."""


GITLINK_MODE = "160000"
"""An index entry pointing at another repository's commit, which this repository cannot read."""
BINARY_PROBE_BYTES = 8000
"""Git's own heuristic: a NUL byte in the first 8,000 makes a file binary."""
BATCH_BYTES = 64_000_000
"""Bytes of blob read per `git cat-file --batch` call, so a long history never sits in one pipe."""
BATCH_BLOBS = 500
"""Blobs per call, whichever limit `BATCH_BYTES` leaves unreached first."""


@dataclass(frozen=True, slots=True)
class Source:
    """A text to scan: a file's path, and `where` its bytes came from when not the working tree."""

    path: str
    text: str
    where: str = ""


def git(repo: Path, *args: str, stdin: bytes | None = None) -> bytes:
    """Run git in `repo`; a failure raises `CheckError` with git's own message."""
    done = subprocess.run(["git", "-C", str(repo), *args], input=stdin, capture_output=True)
    if done.returncode != 0:
        message = done.stderr.decode(errors="replace").strip()
        raise CheckError(f"git {args[0]} failed: {message}")
    return done.stdout


def _text(data: bytes) -> str | None:
    return None if b"\0" in data[:BINARY_PROBE_BYTES] else data.decode(errors="replace")


def _zero_split(output: bytes) -> list[str]:
    return [item for item in output.decode(errors="surrogateescape").split("\0") if item]


def tracked_and_staged(repo: Path) -> Iterator[Source]:
    """Every tracked file as it is on disk, and its index version wherever the two differ.

    The index version is what the next commit takes, staged or not.
    """
    for path in dict.fromkeys(_zero_split(git(repo, "ls-files", "-z"))):
        file = repo / path
        if file.is_file() and not file.is_symlink() and (text := _text(file.read_bytes())):
            yield Source(path, text)
    staged: dict[str, str] = {}
    for entry in _zero_split(git(repo, "ls-files", "--stage", "-z")):
        fields, _, path = entry.partition("\t")
        mode, blob, stage = fields.split()
        # A gitlink is another repository's commit, not text here; a conflict's stage 0 wins.
        if mode != GITLINK_MODE and (stage == "0" or path not in staged):
            staged[path] = blob
    differs = [
        path for path in _zero_split(git(repo, "diff", "--name-only", "-z")) if path in staged
    ]
    yield from blobs(repo, _sized(repo, [(staged[path], path) for path in differs]), "index")


def _sized(repo: Path, wanted: Sequence[tuple[str, str]]) -> list[tuple[str, str, int]]:
    """`(blob, path)` with each blob's size, and the objects that are not blobs dropped."""
    if not wanted:
        return []
    probe = "".join(f"{blob}\n" for blob, _ in wanted).encode()
    lines = git(repo, "cat-file", "--batch-check=%(objecttype) %(objectsize)", stdin=probe)
    sized: list[tuple[str, str, int]] = []
    for (blob, path), answer in zip(wanted, lines.decode().splitlines(), strict=True):
        kind, _, size = answer.partition(" ")
        if kind == "blob":
            sized.append((blob, path, int(size)))
    return sized


def _batches(wanted: Sequence[tuple[str, str, int]]) -> Iterator[Sequence[tuple[str, str, int]]]:
    """Split blobs into batches bounded by `BATCH_BYTES` and `BATCH_BLOBS`."""
    chunk: list[tuple[str, str, int]] = []
    size = 0
    for blob in wanted:
        if chunk and (len(chunk) >= BATCH_BLOBS or size + blob[2] > BATCH_BYTES):
            yield chunk
            chunk, size = [], 0
        chunk.append(blob)
        size += blob[2]
    if chunk:
        yield chunk


def blobs(repo: Path, wanted: Sequence[tuple[str, str, int]], label: str = "") -> Iterator[Source]:
    """The text of each `(blob id, path, size)`, in batches; binary blobs are skipped.

    Each is labelled `label`, or by its blob id when no label is given.
    """
    for chunk in _batches(wanted):
        out = git(
            repo, "cat-file", "--batch", stdin="".join(f"{b}\n" for b, _, _ in chunk).encode()
        )
        position = 0
        for blob, path, _ in chunk:
            header_end = out.index(b"\n", position)
            header = out[position:header_end].split()
            if len(header) != 3:
                raise CheckError(f"git cat-file cannot read {blob} ({path})")
            body_end = header_end + 1 + int(header[2])
            position = body_end + 1
            if text := _text(out[header_end + 1 : body_end]):
                yield Source(path, text, label or f"blob {blob[:12]}")


def history(repo: Path, revs: Sequence[str]) -> Iterator[Source]:
    """Every blob in the commits `revs` select (git rev-list arguments), each blob once."""
    listing = git(repo, "rev-list", "--objects", *revs, "--").decode(errors="surrogateescape")
    named = [(oid, path) for oid, _, path in (row.partition(" ") for row in listing.splitlines())]
    yield from blobs(repo, _sized(repo, [pair for pair in named if pair[1]]))


def pushed_revs(remote: str, lines: Iterable[str], has_commit: Callable[[str], bool]) -> list[str]:
    """The rev-list arguments for what a push would send, from git's pre-push stdin.

    Each line is `<local ref> <local oid> <remote ref> <remote oid>`. Deleting a ref sends
    nothing. A remote tip this clone does not hold -- a force-push over a rewritten history --
    excludes nothing, so all that no remote-tracking ref of `remote` already reaches is scanned.
    """
    tips: list[str] = []
    known: list[str] = []
    for line in lines:
        fields = line.split()
        if not fields:
            continue
        if len(fields) != 4:
            raise CheckError(f"not a pre-push line: {line.strip()!r}")
        _, local, _, remote_tip = fields
        if set(local) != {"0"}:
            tips.append(local)
            if set(remote_tip) != {"0"} and has_commit(remote_tip):
                known.append(f"^{remote_tip}")
    return [*tips, *known, "--not", f"--remotes={remote}"] if tips else []
