#!/usr/bin/env bash
# Phase 6 smoke: Kafka ready, topic present, generator on, raw.events grows over 60s.
set -euo pipefail
NS="${NS:-data-platform}"

echo "== kafka cluster ready =="
kubectl -n "$NS" wait --for=condition=Ready kafka/platform --timeout=300s
echo "== topic =="
kubectl -n "$NS" get kafkatopic clickstream
echo "== kafka-ui rollout =="
kubectl -n "$NS" rollout status deploy/kafka-ui --timeout=120s

echo "== ensure generator running =="
kubectl -n "$NS" scale deploy/event-gen --replicas=1
kubectl -n "$NS" rollout status deploy/event-gen --timeout=120s

CHPOD=$(kubectl -n "$NS" get pods -l clickhouse.altinity.com/chi=platform -o jsonpath='{.items[0].metadata.name}')
ch() { kubectl -n "$NS" exec "$CHPOD" -c clickhouse -- \
  clickhouse-client --user admin --password admin -q "$1"; }

C1=$(ch "SELECT count() FROM raw.events")
echo "raw.events @ t0 = $C1"
echo "waiting 60s for events to flow..."
sleep 60
C2=$(ch "SELECT count() FROM raw.events")
echo "raw.events @ t1 = $C2"

[ "$C2" -gt "$C1" ] || { echo "FAIL: raw.events not growing ($C1 -> $C2)"; exit 1; }
echo "PASS: Phase 6 streaming smoke green (raw.events $C1 -> $C2)."
