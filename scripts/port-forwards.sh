#!/usr/bin/env bash
# Start background port-forwards for every installed console/UI. Re-run safe (kills old ones).
# Human access only — service-to-service traffic uses cluster DNS, never these.
set -uo pipefail
NS="${NS:-data-platform}"

pf() { # name  local:remote  svc
  local name="$1" map="$2" svc="$3"
  if kubectl -n "$NS" get "svc/${svc}" >/dev/null 2>&1; then
    pkill -f "port-forward.*${svc}.*${map%%:*}" 2>/dev/null || true
    kubectl -n "$NS" port-forward "svc/${svc}" "$map" >/tmp/pf-${name}.log 2>&1 &
    printf "  %-14s localhost:%s\n" "$name" "${map%%:*}"
  fi
}

echo "Starting port-forwards (ns=$NS)..."
pf minio-console 9001:9001 minio-console   # minio chart exposes console via svc 'minio-console'
pf minio-api     9002:9000 minio
pf airflow       8080:8080 airflow-webserver
pf clickhouse    8123:8123 clickhouse-platform
pf kafka-ui      8081:8080 kafka-ui
pf trino         8082:8080 trino
pf postgres      5433:5432 shop-db-rw
echo "Done. Logs in /tmp/pf-*.log . Stop all: pkill -f 'kubectl.*port-forward'"
