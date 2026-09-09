"""Parser worker: Kafka pointer -> object storage -> parse -> validate -> ClickHouse.

**The idempotency contract**, which is the whole reason this is safe to restart:

  1. Offsets are committed only AFTER the ClickHouse insert returns. Crash before that and
     the message is redelivered.
  2. `hand_uid` is deterministic, and every core table is a `ReplacingMergeTree(parsed_at)`
     keyed on it, so a redelivered hand supersedes rather than duplicates.
  3. Therefore: at-least-once delivery, exactly-once effect. Killing a worker mid-batch loses
     nothing and duplicates nothing.

Same pattern as the lab's `dags/shop_cdc_consumer.py` — deliberately, because it is proven
and already understood.

Run:  uv run python -m ingestion.worker      (or `make worker`)
"""

from __future__ import annotations

import logging
import signal
import sys
from types import FrameType

import psycopg
from confluent_kafka import Consumer, KafkaError, Message

from api.db import clickhouse
from api.settings import get_settings
from core.enums import Site
from ingestion.bus import UploadMessage, make_consumer
from ingestion.pipeline import ingest_text, record_failures
from ingestion.storage import get_raw
from parser.registry import get_parser

log = logging.getLogger("ingestion.worker")

POLL_TIMEOUT = 1.0
ERROR_TEXT_CHARS = 2000
"""How much of an exception message the `uploads.error_text` column keeps."""

_running = True


def record_upload_result(upload_id: str, counts: dict[str, int], error: str = "") -> None:
    """Write the outcome back to the `uploads` row in Postgres.

    A synchronous driver here on purpose: the worker is a plain loop, and dragging an event
    loop into it just to reuse the API's async session would add complexity for no benefit.
    One short-lived connection per file is nothing next to the parse cost.

    Failures are logged, never raised: hands are already durably in ClickHouse at this point,
    and losing the status update must not cause a redelivery that re-does the work.
    """
    settings = get_settings()
    status = "failed" if error else "completed"
    try:
        with psycopg.connect(settings.postgres_libpq_dsn, autocommit=True) as conn:
            conn.execute(
                "UPDATE uploads SET status = %s, hands_found = %s, hands_parsed = %s, "
                "hands_failed = %s, error_text = %s, completed_at = now(), updated_at = now() "
                "WHERE id = %s",
                (
                    status,
                    counts.get("found", 0),
                    counts.get("parsed", 0),
                    counts.get("failed", 0),
                    error[:ERROR_TEXT_CHARS],
                    upload_id,
                ),
            )
    except Exception as exc:
        log.warning("could not update upload %s status: %s", upload_id, exc)


def _stop(signum: int, _frame: FrameType | None) -> None:
    """Finish the in-flight batch, then exit. Never abandon uncommitted work."""
    global _running
    log.info("signal %s received; finishing current batch", signum)
    _running = False


def process(message: UploadMessage) -> dict[str, int]:
    """Parse one uploaded file end to end. Returns counts for the upload record.

    The parse -> validate -> store loop itself lives in `ingestion.pipeline.ingest_text` and is
    shared with the bulk importer. This function only resolves the message into that call.
    A second copy of the loop used to live here, and it had already drifted: it stored every
    upload as `dataset='hero'` and buffered the whole file in memory (docs/POKER_AUDIT.md, B2).
    """
    client = clickhouse()
    parser = get_parser(Site(message.site))
    result = ingest_text(
        client,
        parser,
        get_raw(message.object_key),
        tenant_id=message.tenant_id,
        site=message.site,
        object_key=message.object_key,
        upload_id=message.upload_id,
        hero_names=frozenset(name.lower() for name in message.hero_names),
        dataset=message.dataset,
        batch_size=get_settings().insert_batch_size,
    )
    record_failures(client, result.failures)
    counts = result.as_counts()
    log.info("upload %s: %s", message.upload_id, counts)
    return counts


def _handle(msg: Message) -> bool:
    """Process one Kafka event. Returns True only if its offset may be committed.

    Error events (partition EOF, "topic not available" for a topic nobody has produced to
    yet) carry no offset to commit, and trying to commit one raises. Distinguishing the two
    cases is what keeps the worker from crashing on an idle topic.
    """
    error = msg.error()
    if error is not None:
        if error.code() != KafkaError._PARTITION_EOF:
            log.warning("kafka event: %s", error)
        return False
    payload = msg.value()
    if payload is None:
        return True  # tombstone: nothing to do, but the offset should still advance
    message = UploadMessage.from_json(payload)
    try:
        counts = process(message)
    except Exception as exc:
        log.exception("upload %s failed", message.upload_id)
        record_upload_result(message.upload_id, {}, f"{type(exc).__name__}: {exc}")
        return True
    record_upload_result(message.upload_id, counts)
    return True


def run(consumer: Consumer | None = None) -> int:
    """Consume until stopped. Returns the number of messages processed."""
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    consumer = consumer or make_consumer()
    processed = 0
    try:
        while _running:
            msg = consumer.poll(POLL_TIMEOUT)
            if msg is None:
                continue
            if not _handle(msg):
                continue
            # Commit ONLY after the insert succeeded. This single line is the difference
            # between at-least-once and at-most-once.
            consumer.commit(message=msg, asynchronous=False)
            processed += 1
    finally:
        consumer.close()
    log.info("worker stopped after %d message(s)", processed)
    return processed


def drain(max_idle_polls: int = 5) -> int:
    """Consume until the topics go quiet, then stop. Returns messages processed.

    Used by `make seed` and by the integration test, where "run forever" is the wrong
    behaviour. Same commit-after-insert discipline as `run`.
    """
    consumer = make_consumer()
    processed = 0
    idle = 0
    try:
        while idle < max_idle_polls:
            msg = consumer.poll(POLL_TIMEOUT)
            if msg is None:
                idle += 1
                continue
            if not _handle(msg):
                idle += 1
                continue
            idle = 0
            consumer.commit(message=msg, asynchronous=False)
            processed += 1
    finally:
        consumer.close()
    log.info("drained %d message(s)", processed)
    return processed


def main() -> int:
    """CLI entry point."""
    logging.basicConfig(
        level=logging.INFO,
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s",'
        '"msg":"%(message)s"}',
    )
    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
