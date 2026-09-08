"""Kafka: the ingestion bus.

**Messages carry POINTERS, not payloads.** An upload message is ~200 bytes naming an object in
storage; the hand text stays in S3. The alternative — streaming every parsed hand through
Kafka — would mean 10 million messages for one heavy user's backfill instead of a few
thousand. See docs/POKER_DATA_MODEL.md §7.

**Keyed by `user_id`**, which buys per-user ordering (all a HUD ever needs) without global
ordering, and makes the tenant the natural sharding unit.

**Bulk imports go to a separate topic** so one user's 10M-hand backfill cannot starve
everyone else's live uploads behind it in the same partition.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

from confluent_kafka import Consumer, Producer

from api.settings import get_settings

log = logging.getLogger(__name__)


@dataclass(slots=True, frozen=True)
class UploadMessage:
    """The pointer message. Deliberately small and boring."""

    upload_id: str
    tenant_id: int
    site: str
    object_key: str
    sha256: str
    hero_names: list[str]
    """The user's registered screen names, so the worker can resolve which seat is hero
    without a database round trip per file."""

    def to_json(self) -> bytes:
        """Serialize for the wire."""
        return json.dumps(asdict(self), separators=(",", ":")).encode()

    @staticmethod
    def from_json(raw: bytes) -> UploadMessage:
        """Deserialize from the wire."""
        payload: dict[str, Any] = json.loads(raw)
        return UploadMessage(
            upload_id=payload["upload_id"],
            tenant_id=int(payload["tenant_id"]),
            site=payload["site"],
            object_key=payload["object_key"],
            sha256=payload["sha256"],
            hero_names=list(payload.get("hero_names", [])),
        )


_producer: Producer | None = None


def producer() -> Producer:
    """Process-wide producer."""
    global _producer
    if _producer is None:
        settings = get_settings()
        _producer = Producer(
            {
                "bootstrap.servers": settings.kafka_bootstrap,
                "enable.idempotence": True,
                "acks": "all",
                "linger.ms": 20,
            }
        )
    return _producer


def publish_upload(message: UploadMessage, *, bulk: bool = False) -> None:
    """Publish an upload pointer. `bulk=True` routes to the isolated backfill topic."""
    settings = get_settings()
    topic = settings.kafka_bulk_topic if bulk else settings.kafka_uploads_topic
    p = producer()
    p.produce(topic, key=str(message.tenant_id).encode(), value=message.to_json())
    p.poll(0)
    p.flush(5.0)
    log.info("published upload %s to %s", message.upload_id, topic)


def make_consumer(topics: list[str] | None = None) -> Consumer:
    """Build a consumer with manual offset commits.

    `enable.auto.commit=False` is the whole correctness story: offsets are committed only
    AFTER the ClickHouse insert succeeds. Combined with ReplacingMergeTree dedup on
    `hand_uid`, that gives at-least-once delivery with exactly-once *effect* — the same
    pattern as the lab's `dags/shop_cdc_consumer.py`.
    """
    settings = get_settings()
    consumer = Consumer(
        {
            "bootstrap.servers": settings.kafka_bootstrap,
            "group.id": settings.kafka_consumer_group,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
        }
    )
    consumer.subscribe(topics or [settings.kafka_uploads_topic, settings.kafka_bulk_topic])
    return consumer
