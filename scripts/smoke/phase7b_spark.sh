#!/usr/bin/env bash
# Phase 7b smoke: the demo SparkApplication reaches COMPLETED and writes output to MinIO.
set -euo pipefail
NS="${NS:-data-platform}"
APP=shop-daily-revenue

echo "== wait for SparkApplication to finish =="
for i in $(seq 1 60); do
  STATE=$(kubectl -n "$NS" get sparkapplication "$APP" -o jsonpath='{.status.applicationState.state}' 2>/dev/null || true)
  echo "  state: ${STATE:-<pending>}"
  case "$STATE" in
    COMPLETED) break ;;
    FAILED|FAILING|UNKNOWN) echo "FAIL: SparkApplication state=$STATE"; exit 1 ;;
  esac
  sleep 10
done
[ "$STATE" = "COMPLETED" ] || { echo "FAIL: SparkApplication did not complete in time"; exit 1; }

echo "== verify Iceberg table data written to the lakehouse bucket =="
OUT=$(kubectl -n "$NS" run mc-p7b-$$ --rm -i --restart=Never \
  --image=minio/mc:RELEASE.2025-08-13T08-35-41Z-cpuv1 \
  --env="MC_HOST_local=http://minioadmin:minioadmin@minio:9000" --command -- \
  sh -c 'mc ls --recursive local/lakehouse/warehouse/shop/' 2>/dev/null)
echo "$OUT" | grep -q 'metadata.json' || { echo "FAIL: no Iceberg metadata under lakehouse/warehouse/shop/"; exit 1; }
echo "$OUT" | grep -q 'order_date_month=' || { echo "FAIL: no month-partitioned data files under lakehouse/warehouse/shop/"; exit 1; }
echo "  Iceberg data + metadata present (month-partitioned)"

echo "PASS: Phase 7b Spark smoke green (COMPLETED + partitioned Iceberg written to MinIO)."
