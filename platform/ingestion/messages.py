"""The upload pointer message. Pure data, no transport.

Lives apart from `ingestion.bus` (Kafka) so the parser worker, the sinks' Protocols and the
tests can name the message type without importing a Kafka client.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any

from ingestion.loader import DATASET_HERO


class PublishError(RuntimeError):
    """The bus did not acknowledge a pointer: it refused it, timed it out, or said nothing.

    The pointer is dropped from the producer when it times out, so it will not arrive later in
    the normal case. A pointer that timed out in flight may still have been stored by the broker,
    though, which is why the worker skips a message whose upload is already `failed`
    (`ingestion.upload_status.claim`). Defined beside the message rather than in `ingestion.bus`
    so the message layer can name it without importing the Kafka client.
    """


@dataclass(slots=True, frozen=True)
class UploadMessage:
    """The pointer message. Deliberately small and boring.

    **Messages carry POINTERS, not payloads.** An upload message is ~200 bytes naming an object
    in storage; the hand text stays there. Streaming every parsed hand through the bus would
    mean 10 million messages for one heavy user's backfill instead of a few thousand
    (docs/POKER_DATA_MODEL.md §7).
    """

    upload_id: str
    tenant_id: int
    site: str
    object_key: str
    sha256: str
    hero_names: list[str]
    """The user's registered screen names, so the worker can resolve which seat is hero
    without a database round trip per file."""
    dataset: str = DATASET_HERO
    """`hero` (own play) or `population` (observed pool). Carried on the message because the
    worker must never guess it: a file stored under the wrong dataset silently pollutes every
    win rate. Defaults to `hero`, which is what a browser upload of one's own history is."""

    def to_json(self) -> bytes:
        """Serialize for the wire."""
        return json.dumps(asdict(self), separators=(",", ":")).encode()

    @staticmethod
    def from_json(raw: bytes) -> UploadMessage:
        """Deserialize from the wire. Messages produced before `dataset` existed are hero."""
        payload: dict[str, Any] = json.loads(raw)
        return UploadMessage(
            upload_id=payload["upload_id"],
            tenant_id=int(payload["tenant_id"]),
            site=payload["site"],
            object_key=payload["object_key"],
            sha256=payload["sha256"],
            hero_names=list(payload.get("hero_names", [])),
            dataset=str(payload.get("dataset", DATASET_HERO)),
        )
