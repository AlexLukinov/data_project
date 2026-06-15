#!/usr/bin/env bash
# Phase 4 smoke: run the batch DAG end-to-end (all 3 tasks), then verify raw.orders count.
# Uses `airflow dags test` so the smoke is synchronous + returns a clear exit code.
# (The Airflow UI "Trigger DAG" exercises the scheduler + LocalExecutor path.)
set -euo pipefail
NS="${NS:-data-platform}"
DS="${DS:-2026-06-11}"

SCHED=$(kubectl -n "$NS" get pod -l component=scheduler -o jsonpath='{.items[0].metadata.name}')
echo "scheduler pod: $SCHED"

echo "== run shop_batch_pipeline for ds=$DS =="
kubectl -n "$NS" exec "$SCHED" -c scheduler -- airflow dags test shop_batch_pipeline "$DS"

echo "== verify Parquet landed in MinIO =="
U=$(kubectl -n "$NS" get secret minio-root -o jsonpath='{.data.rootUser}' | base64 -d)
P=$(kubectl -n "$NS" get secret minio-root -o jsonpath='{.data.rootPassword}' | base64 -d)
PARQUET=$(kubectl -n "$NS" run mc-p4-$$ --rm -i --restart=Never --image=minio/mc:RELEASE.2025-08-13T08-35-41Z-cpuv1 \
  --env="MC_HOST_local=http://$U:$P@minio:9000" --command -- \
  sh -c "mc ls --recursive local/raw/shop/orders/" 2>/dev/null)
echo "$PARQUET" | grep -q "dt=$DS/data.parquet" \
  || { echo "FAIL: orders parquet for dt=$DS not found"; echo "$PARQUET"; exit 1; }

echo "== verify raw.orders count matches source =="
CHPOD=$(kubectl -n "$NS" get pods -l clickhouse.altinity.com/chi=platform -o jsonpath='{.items[0].metadata.name}')
ORDERS=$(kubectl -n "$NS" exec "$CHPOD" -c clickhouse -- \
  clickhouse-client --user admin --password admin -q "SELECT count() FROM raw.orders")
echo "raw.orders = $ORDERS"
[ "$ORDERS" = "10000" ] || { echo "FAIL: raw.orders=$ORDERS != 10000"; exit 1; }

echo "PASS: Phase 4 Airflow smoke green (3 tasks ran; parquet in MinIO; raw.orders=10000)."
