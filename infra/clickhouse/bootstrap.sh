#!/usr/bin/env bash
# Create the raw / staging / marts databases in ClickHouse. Idempotent.
set -euo pipefail
NS="${NS:-data-platform}"

POD=$(kubectl -n "$NS" get pods -l "clickhouse.altinity.com/chi=platform" \
  -o jsonpath='{.items[0].metadata.name}')
echo "==> bootstrapping ClickHouse on pod $POD"

kubectl -n "$NS" exec "$POD" -c clickhouse -- \
  clickhouse-client --user admin --password admin --multiquery -q "
    CREATE DATABASE IF NOT EXISTS raw;
    CREATE DATABASE IF NOT EXISTS staging;
    CREATE DATABASE IF NOT EXISTS marts;
    SHOW DATABASES;
  "
echo "==> ClickHouse databases ready."
