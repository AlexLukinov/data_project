"""`EventBus` on Kafka (or anything speaking its protocol: Redpanda, a managed service)."""

from __future__ import annotations

from ingestion.bus import publish_upload
from ingestion.messages import UploadMessage


class KafkaBus:
    """Thin object over `ingestion.bus`, which owns the producer and the topic names."""

    def publish_upload(self, message: UploadMessage, *, bulk: bool = False) -> None:
        """Publish one upload pointer, keyed by tenant."""
        publish_upload(message, bulk=bulk)
