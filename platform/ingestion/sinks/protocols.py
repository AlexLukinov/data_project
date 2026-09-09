"""The three ingestion seams, as Protocols. Implementations live beside this module."""

from __future__ import annotations

from typing import Protocol

from core.models import CanonicalHand
from ingestion.messages import UploadMessage

PARSE_FAILURE_COLUMNS: tuple[str, ...] = (
    "user_id",
    "upload_id",
    "site",
    "raw_object_key",
    "raw_byte_offset",
    "hand_excerpt",
    "error_code",
    "error_message",
    "parser_version",
)
"""Column order of a dead-letter row: built by `ingestion.pipeline`, written by
`HandSink.record_failures`. One definition here, at the seam, so the two cannot drift."""


class HandSink(Protocol):
    """Where parsed hands and dead letters go."""

    def insert_hands(
        self, hands: list[CanonicalHand], tenant_id: int, dataset: str
    ) -> dict[str, int]:
        """Store a batch of validated hands under a tenant and dataset; per-table row counts."""
        ...

    def record_failures(self, rows: list[list[object]]) -> None:
        """Store dead-letter rows shaped as `PARSE_FAILURE_COLUMNS`."""
        ...


class RawStore(Protocol):
    """Immutable raw hand text, keyed by `ingestion.storage.object_key`."""

    def put(self, key: str, data: bytes) -> int:
        """Store raw text; returns the stored (compressed) byte count."""
        ...

    def get(self, key: str) -> str:
        """Fetch raw text as str."""
        ...


class EventBus(Protocol):
    """Where upload pointers are published."""

    def publish_upload(self, message: UploadMessage, *, bulk: bool = False) -> None:
        """Publish one pointer; `bulk=True` routes to the isolated backfill topic."""
        ...
