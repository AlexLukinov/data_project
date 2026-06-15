#!/usr/bin/env bash
# Phase 7a smoke: Trino coordinator up; query ClickHouse marts.daily_revenue through Trino.
set -euo pipefail
NS="${NS:-data-platform}"

echo "== trino coordinator rollout =="
kubectl -n "$NS" rollout status deploy/trino-coordinator --timeout=180s

POD=$(kubectl -n "$NS" get pod \
  -l app.kubernetes.io/name=trino,app.kubernetes.io/component=coordinator \
  -o jsonpath='{.items[0].metadata.name}')
echo "coordinator: $POD"

echo "== query clickhouse.marts.daily_revenue via Trino =="
OUT=$(kubectl -n "$NS" exec "$POD" -- \
  trino --server http://localhost:8080 \
  --execute "SELECT order_date, orders, revenue FROM clickhouse.marts.daily_revenue ORDER BY order_date LIMIT 5")
echo "$OUT"

[ -n "$OUT" ] || { echo "FAIL: Trino returned no rows from clickhouse.marts.daily_revenue"; exit 1; }
echo "PASS: Phase 7a Trino smoke green (clickhouse catalog reachable)."
