"""CDC consumer: Debezium Postgres change events (Kafka) -> ClickHouse staging.cdc_events.

Idempotent by design: staging.cdc_events is a ReplacingMergeTree(_version) keyed by
(source_table, id), so duplicate deliveries (e.g. Debezium re-snapshots) collapse to the
latest version. The consumer commits offsets only after a successful ClickHouse insert."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime

from airflow import DAG
from airflow.operators.python import PythonOperator

log = logging.getLogger(__name__)

TOPICS = ["shop.public.customers", "shop.public.orders", "shop.public.order_items"]
CONSUMER_GROUP = "airflow-cdc-consumer"
IDLE_POLLS_BEFORE_STOP = 5      # ~5s of empty polls => drained
MAX_MESSAGES_PER_RUN = 100_000  # safety cap so a task run is always bounded


def _ch_client():
    """ClickHouse client from the chart-injected connection env vars."""
    import clickhouse_connect
    return clickhouse_connect.get_client(
        host=os.environ["CLICKHOUSE_HOST"], port=int(os.environ["CLICKHOUSE_PORT"]),
        username=os.environ["CLICKHOUSE_USER"], password=os.environ["CLICKHOUSE_PASSWORD"])


def _ensure_table(client) -> None:
    """Create the idempotent CDC landing table (latest _version per key wins)."""
    client.command("CREATE DATABASE IF NOT EXISTS staging")
    client.command(
        "CREATE TABLE IF NOT EXISTS staging.cdc_events ("
        "source_table LowCardinality(String), id Int64, op LowCardinality(String), "
        "payload String, _version UInt64, _deleted UInt8, "
        "ingested_at DateTime64(3) DEFAULT now64(3)) "
        "ENGINE = ReplacingMergeTree(_version) ORDER BY (source_table, id)")


def _row_from_event(event: dict) -> list | None:
    """Map a Debezium envelope to a staging.cdc_events row; None if it carries no key."""
    op = event.get("op")                       # r=snapshot, c/u=upsert, d=delete
    record = event.get("before") if op == "d" else event.get("after")
    if not record or "id" not in record:
        return None
    source = event.get("source", {})
    version = int(event.get("ts_ms") or source.get("ts_ms") or 0)
    return [source.get("table", "?"), int(record["id"]), op,
            json.dumps(record, separators=(",", ":")), version, 1 if op == "d" else 0]


def consume_cdc_to_clickhouse(**_) -> None:
    """Drain the CDC topics once and batch-insert the changes into ClickHouse."""
    from confluent_kafka import Consumer
    client = _ch_client()
    _ensure_table(client)
    consumer = Consumer({"bootstrap.servers": os.environ["KAFKA_BOOTSTRAP"],
                         "group.id": CONSUMER_GROUP, "auto.offset.reset": "earliest",
                         "enable.auto.commit": False})
    consumer.subscribe(TOPICS)
    rows, idle, consumed = [], 0, 0
    try:
        while idle < IDLE_POLLS_BEFORE_STOP and consumed < MAX_MESSAGES_PER_RUN:
            msg = consumer.poll(1.0)
            if msg is None:
                idle += 1
                continue
            idle = 0
            consumed += 1
            if msg.error() or msg.value() is None:   # error or delete tombstone
                continue
            row = _row_from_event(json.loads(msg.value()))
            if row:
                rows.append(row)
        if rows:
            client.insert("staging.cdc_events", rows,
                          column_names=["source_table", "id", "op", "payload", "_version", "_deleted"])
        if consumed:      # nothing new -> nothing to commit (avoids _NO_OFFSET on idempotent re-runs)
            consumer.commit(asynchronous=False)
    finally:
        consumer.close()
    log.info("consumed %d CDC events into staging.cdc_events", len(rows))


with DAG(
    dag_id="shop_cdc_consumer",
    description="Debezium CDC (Kafka) -> ClickHouse staging.cdc_events (idempotent)",
    start_date=datetime(2026, 1, 1),
    schedule=None,          # triggered on demand for the lab
    catchup=False,
    tags=["lab", "cdc", "streaming"],
) as dag:
    PythonOperator(task_id="consume_cdc_to_clickhouse", python_callable=consume_cdc_to_clickhouse)
