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

import logging
import time

from confluent_kafka import Consumer, KafkaError, Message, Producer

from core.settings import get_settings
from ingestion.messages import PublishError, UploadMessage

log = logging.getLogger(__name__)

DELIVERY_TIMEOUT_MS = 5_000
"""librdkafka's `message.timeout.ms`: after this long an unacknowledged pointer is dropped and
reported as timed out, instead of being retried in the background for the default five minutes
and delivered after the API has already told the uploader it was not sent (measured: the report
arrives at 5.0 s and the producer's queue is empty)."""
ACK_WAIT_SECONDS = DELIVERY_TIMEOUT_MS / 1000 + 2
"""How long `publish_upload` waits for the pointer's own delivery report; longer than the
timeout above, so a timed-out pointer is reported rather than waited out."""
POLL_STEP_SECONDS = 0.1

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
                "message.timeout.ms": DELIVERY_TIMEOUT_MS,
            }
        )
    return _producer


def publish_upload(message: UploadMessage, *, bulk: bool = False) -> None:
    """Publish an upload pointer. `bulk=True` routes to the isolated backfill topic.

    Returns once the broker has acknowledged **this** pointer, and raises `PublishError` when it
    refused it, or timed it out, or said nothing within `ACK_WAIT_SECONDS`. Success is read from the
    pointer's own delivery report, not from `flush()`: `flush()` counts every message in the
    process-wide producer, so a concurrent upload's stuck pointer would fail this one.
    """
    settings = get_settings()
    topic = settings.kafka_bulk_topic if bulk else settings.kafka_uploads_topic
    reports: list[KafkaError | None] = []

    def delivered(error: KafkaError | None, _message: Message) -> None:
        reports.append(error)

    p = producer()
    p.produce(
        topic, key=str(message.tenant_id).encode(), value=message.to_json(), on_delivery=delivered
    )
    deadline = time.monotonic() + ACK_WAIT_SECONDS
    while not reports and time.monotonic() < deadline:
        p.poll(POLL_STEP_SECONDS)
    if not reports:
        raise PublishError(f"no delivery report for upload {message.upload_id}")
    if reports[0] is not None:
        raise PublishError(f"upload {message.upload_id} not delivered: {reports[0]}")
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
