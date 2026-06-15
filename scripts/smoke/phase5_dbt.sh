#!/usr/bin/env bash
# Phase 5 smoke: dbt marts exist and are populated (dbt build runs inside the batch DAG).
set -euo pipefail
NS="${NS:-data-platform}"

CHPOD=$(kubectl -n "$NS" get pods -l clickhouse.altinity.com/chi=platform -o jsonpath='{.items[0].metadata.name}')
ch() { kubectl -n "$NS" exec "$CHPOD" -c clickhouse -- \
  clickhouse-client --user admin --password admin -q "$1"; }

echo "== mart row counts =="
FCT=$(ch "SELECT count() FROM marts.fct_orders")
DR=$(ch "SELECT count() FROM marts.daily_revenue")
echo "marts.fct_orders   = $FCT"
echo "marts.daily_revenue= $DR (distinct days)"

[ "$FCT" = "10000" ] || { echo "FAIL: fct_orders=$FCT != 10000"; exit 1; }
[ "$DR" -gt 0 ] || { echo "FAIL: daily_revenue is empty"; exit 1; }

echo "== sample daily_revenue =="
ch "SELECT order_date, orders, revenue FROM marts.daily_revenue ORDER BY order_date LIMIT 5 FORMAT PrettyCompact"

echo "PASS: Phase 5 dbt smoke green (fct_orders=$FCT, daily_revenue=$DR days)."
