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

from confluent_kafka import Consumer, KafkaError, Message

from core.enums import Site
from core.settings import get_settings
from ingestion import sinks
from ingestion.bus import make_consumer
from ingestion.cache import invalidate_tenant
from ingestion.messages import UploadMessage
from ingestion.pipeline import IngestResult, Progress, ingest_text
from ingestion.sinks.protocols import HandSink, RawStore
from ingestion.upload_status import claim, record_failure, record_outcome, record_progress
from parser.registry import get_parser

log = logging.getLogger("ingestion.worker")

POLL_TIMEOUT = 1.0

_running = True


def _stop(signum: int, _frame: FrameType | None) -> None:
    """Finish the in-flight batch, then exit. Never abandon uncommitted work."""
    global _running
    log.info("signal %s received; finishing current batch", signum)
    _running = False


def process(
    message: UploadMessage,
    *,
    sink: HandSink | None = None,
    store: RawStore | None = None,
    progress: Progress | None = None,
) -> dict[str, int]:
    """Parse one uploaded file end to end. Returns counts for the upload record.

    The parse -> validate -> store loop itself lives in `ingestion.pipeline.ingest_text` and is
    shared with the bulk importer. This function only resolves the message into that call.
    A second copy of the loop used to live here, and it had already drifted: it stored every
    upload as `dataset='hero'` and buffered the whole file in memory (docs/POKER_AUDIT.md, B2).

    `sink` and `store` default to the real ClickHouse and S3 implementations; tests pass the
    fakes from `ingestion.sinks`. `progress` is told the running totals after each stored batch.
    """
    sink = sink if sink is not None else sinks.hand_sink()
    store = store if store is not None else sinks.raw_store()
    parser = get_parser(Site(message.site))
    result = ingest_text(
        sink,
        parser,
        store.get(message.object_key),
        tenant_id=message.tenant_id,
        site=message.site,
        object_key=message.object_key,
        upload_id=message.upload_id,
        hero_names=frozenset(name.lower() for name in message.hero_names),
        dataset=message.dataset,
        batch_size=get_settings().insert_batch_size,
        progress=progress,
    )
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
    if not claim(message.upload_id):
        log.warning("upload %s already failed; skipping its late pointer", message.upload_id)
        return True
    try:
        counts = process(message, progress=_progress_of(message.upload_id))
    except Exception:
        # Logged in full here and nowhere else: the row gets a sentence, because the uploader
        # reads it and a storage exception names hosts and SQL (ADR-051).
        log.exception("upload %s failed", message.upload_id)
        invalidate_tenant(message.tenant_id)  # earlier batches of the file may be in stats
        record_failure(message.upload_id)
        return True
    # Before the status, not after: a page re-reads its reports the moment it sees the upload
    # end, and must not be answered from an entry cached before these hands (ADR-047, ADR-051).
    invalidate_tenant(message.tenant_id)
    record_outcome(message.upload_id, counts, message.site)
    return True


def _progress_of(upload_id: str) -> Progress:
    """Write the running totals to the upload row after every stored batch."""

    def report(result: IngestResult) -> None:
        record_progress(upload_id, result.as_counts())

    return report


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
