#!/usr/bin/env bash
# Phase 3 smoke: CH up, raw/staging/marts exist, and s3()->MinIO path-style returns 3 rows.
set -euo pipefail
NS="${NS:-data-platform}"

POD=$(kubectl -n "$NS" get pods -l "clickhouse.altinity.com/chi=platform" \
  -o jsonpath='{.items[0].metadata.name}')
echo "ch pod: $POD"

ch() { kubectl -n "$NS" exec "$POD" -c clickhouse -- \
  clickhouse-client --user admin --password admin -q "$1"; }

echo "== databases =="
DBS=$(ch "SELECT name FROM system.databases WHERE name IN ('raw','staging','marts') ORDER BY name FORMAT TSV")
echo "$DBS"
for d in marts raw staging; do echo "$DBS" | grep -qx "$d" || { echo "FAIL: db $d missing"; exit 1; }; done

echo "== s3() -> MinIO path-style =="
CNT=$(ch "SELECT count() FROM s3('http://minio.data-platform.svc.cluster.local:9000/raw/_smoke/smoke.csv','minioadmin','minioadmin','CSVWithNames')")
echo "rows from smoke.csv via s3(): $CNT"
[ "$CNT" = "3" ] || { echo "FAIL: expected 3, got $CNT"; exit 1; }

echo "PASS: Phase 3 ClickHouse smoke green (dbs + s3->MinIO = 3)."
