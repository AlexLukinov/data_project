#!/usr/bin/env bash
# Phase 9 smoke: the CDC path works end to end.
#  1) The Debezium connector is RUNNING and the per-table CDC topics carry data.
#  2) The Airflow consumer lands changes into ClickHouse staging.cdc_events, deduplicated by
#     ReplacingMergeTree so the current (non-deleted) state matches the Postgres source count.
#  3) Re-running the consumer is idempotent (deduped count is unchanged).
set -euo pipefail
NS="${NS:-data-platform}"
BOOT=platform-kafka-bootstrap.data-platform.svc:9092

echo "== debezium connector state =="
ST=$(kubectl -n "$NS" get kafkaconnector shop-postgres -o jsonpath='{.status.connectorStatus.connector.state}')
echo "  connector: $ST"
[ "$ST" = "RUNNING" ] || { echo "FAIL: connector not RUNNING"; exit 1; }

echo "== CDC topics carry data =="
OFF=$(kubectl -n "$NS" run kt-p9-$$ --rm -i --restart=Never --image=quay.io/strimzi/kafka:1.0.0-kafka-4.2.0 --command -- \
  sh -c "bin/kafka-get-offsets.sh --bootstrap-server $BOOT --topic shop.public.customers 2>/dev/null | awk -F: '{s+=\$3} END{print s+0}'" 2>/dev/null \
  | grep -E '^[0-9]+$' | head -1)
echo "  shop.public.customers end-offset: $OFF"
[ "${OFF:-0}" -gt 0 ] 2>/dev/null || { echo "FAIL: no CDC data in shop.public.customers"; exit 1; }

echo "== run the Airflow CDC consumer DAG (synchronous) =="
SCHED=$(kubectl -n "$NS" get pod -l component=scheduler -o jsonpath='{.items[0].metadata.name}')
kubectl -n "$NS" exec "$SCHED" -c scheduler -- airflow dags test shop_cdc_consumer 2>&1 | tail -2

CHPOD=$(kubectl -n "$NS" get pods -l clickhouse.altinity.com/chi=platform -o jsonpath='{.items[0].metadata.name}')
ch() { kubectl -n "$NS" exec "$CHPOD" -c clickhouse -- clickhouse-client --user admin --password admin -q "$1"; }

echo "== staging.cdc_events landed + deduped vs source =="
SRC=$(kubectl -n "$NS" exec shop-db-1 -- psql -U postgres -d shop -tAc "SELECT count(*) FROM customers")
CH1=$(ch "SELECT count() FROM staging.cdc_events FINAL WHERE source_table='customers' AND _deleted=0")
echo "  postgres customers=$SRC  |  clickhouse deduped=$CH1"
[ "$CH1" = "$SRC" ] || { echo "FAIL: deduped customers ($CH1) != source ($SRC)"; exit 1; }

echo "== idempotency: re-run consumer, deduped count unchanged =="
kubectl -n "$NS" exec "$SCHED" -c scheduler -- airflow dags test shop_cdc_consumer >/dev/null 2>&1 || true
CH2=$(ch "SELECT count() FROM staging.cdc_events FINAL WHERE source_table='customers' AND _deleted=0")
echo "  clickhouse deduped after re-run=$CH2"
[ "$CH2" = "$SRC" ] || { echo "FAIL: not idempotent ($CH2 != $SRC)"; exit 1; }

echo "PASS: Phase 9 CDC smoke green (Debezium -> Kafka -> Airflow -> ClickHouse staging, idempotent)."
