"""What an uploaded file is, decided before anything is stored (plan D.8, ADR-051).

Every refusal here is a 4xx with a sentence the upload page shows as it is, so each one says
what to do next rather than what went wrong inside: a zip is told to be unzipped, a file too
large is told the limit, a site that cannot be told apart is asked for.

**A declared site is checked against the text.** A wrong `site` used to be accepted, split into
zero hands and stored as a `completed` upload with nothing in it -- the one mislabelling the
sniffer exists to catch, let through whenever the user was sure of themselves.

The work is CPU-bound for a large file (a hash, a decode, a sniff over up to 200 MB), so the
router runs `inspect` in a thread rather than on the event loop the status polls share.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status

from core.enums import Site
from ingestion.storage import decode_upload, sha256_of
from parser.errors import FormatDetectionError
from parser.registry import get_parser, sniff, supported_sites

BULK_THRESHOLD_BYTES = 5 * 1024 * 1024
"""Above this, route to the isolated bulk topic so one user's backfill cannot starve
everyone else's live uploads sharing a partition. The hot path runs for both topics."""

MIB = 1024 * 1024
ZIP_MAGIC = b"PK\x03\x04"
"""The first four bytes of every zip archive -- the form an export usually arrives in."""

EMPTY = "The file is empty."
ZIP = "This is a zip archive. Unzip it and upload the .txt hand histories inside."
UNDETECTED = (
    "Could not tell which poker site this file is from. Choose the site and upload it again."
)


@dataclass(slots=True, frozen=True)
class Incoming:
    """One accepted file: decoded, fingerprinted and attributed to a site, before storage."""

    data: bytes
    text: str
    digest: str
    site: Site
    filename: str

    @property
    def is_bulk(self) -> bool:
        """True when the file goes to the bulk topic."""
        return len(self.data) > BULK_THRESHOLD_BYTES


def _supported_codes() -> list[str]:
    return [s.value for s in supported_sites()]


def _declared(site: str, text: str) -> Site:
    """The site the uploader chose, when it is one we parse and the text agrees with it."""
    if site not in _supported_codes():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown site {site!r}. Supported: {', '.join(_supported_codes())}.",
        )
    declared = Site(site)
    parser = get_parser(declared)
    # `matches` looks for the header at the very start of the text; `split` finds it on any line.
    # A file with a preamble fails the first and passes the second -- which is what choosing the
    # site is for. A file of the other site's hands passes neither: the headers never overlap.
    if not parser.matches(text) and next(iter(parser.split(text)), None) is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"This file does not look like a {declared.value} hand history. "
            "Choose the right site, or let the site be detected.",
        )
    return declared


def resolve_site(site: str, text: str) -> Site:
    """The declared site when given and consistent with the text, otherwise sniffed from it."""
    if site:
        return _declared(site, text)
    try:
        return sniff(text)
    except FormatDetectionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, UNDETECTED) from exc


def inspect(data: bytes, filename: str, site: str, max_bytes: int) -> Incoming:
    """Size-check, refuse what is not a hand-history text, decode, and resolve the site."""
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, EMPTY)
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"The file is larger than {max_bytes // MIB} MB. Split it and upload the parts.",
        )
    if data.startswith(ZIP_MAGIC):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, ZIP)
    text = decode_upload(data)
    return Incoming(
        data=data,
        text=text,
        digest=sha256_of(data),
        site=resolve_site(site, text),
        filename=filename,
    )
