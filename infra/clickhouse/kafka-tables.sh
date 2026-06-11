#!/usr/bin/env bash
# ClickHouse streaming ingestion: Kafka engine table -> materialized view -> MergeTree. Idempotent.
set -euo pipefail
NS="${NS:-data-platform}"

POD=$(kubectl -n "$NS" get pods -l "clickhouse.altinity.com/chi=platform" \
  -o jsonpath='{.items[0].metadata.name}')
echo "==> creating Kafka engine tables on $POD"

kubectl -n "$NS" exec "$POD" -c clickhouse -- \
  clickhouse-client --user admin --password admin --multiquery -q "
CREATE TABLE IF NOT EXISTS raw.kafka_clickstream
(event_id String, user_id UInt32, event_type LowCardinality(String), page String, ts DateTime)
ENGINE = Kafka SETTINGS
  kafka_broker_list = 'platform-kafka-bootstrap.data-platform.svc:9092',
  kafka_topic_list = 'clickstream',
  kafka_group_name = 'ch-clickstream',
  kafka_format = 'JSONEachRow';

CREATE TABLE IF NOT EXISTS raw.events
(event_id String, user_id UInt32, event_type LowCardinality(String), page String, ts DateTime)
ENGINE = MergeTree ORDER BY (ts, user_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS raw.mv_events TO raw.events AS
  SELECT * FROM raw.kafka_clickstream;
"
echo "==> Kafka tables + materialized view ready."
