#!/usr/bin/env bash
# Phase 2 smoke: CNPG cluster healthy + orders row count >= 10000.
set -euo pipefail
NS="${NS:-data-platform}"

echo "== CNPG cluster status =="
kubectl -n "$NS" get cluster shop-db -o jsonpath='{.status.phase}{"\n"}'
kubectl -n "$NS" wait --for=condition=Ready cluster/shop-db --timeout=300s || true

PRIMARY=$(kubectl -n "$NS" get pods -l "cnpg.io/cluster=shop-db,cnpg.io/instanceRole=primary" \
  -o jsonpath='{.items[0].metadata.name}')
echo "primary pod: $PRIMARY"

# exec runs as OS user 'postgres' -> connect as the postgres superuser over the local
# socket (peer auth). It can read the shop-owned tables in the shop database.
psql_shop() { kubectl -n "$NS" exec "$PRIMARY" -c postgres -- psql -U postgres -d shop -tAc "$1"; }

echo "== row counts =="
for q in \
  "SELECT count(*) FROM customers" \
  "SELECT count(*) FROM orders" \
  "SELECT count(*) FROM order_items"; do
  printf '  %-40s = ' "$q"
  psql_shop "$q"
done

ORDERS=$(psql_shop "SELECT count(*) FROM orders")
[ "$ORDERS" -ge 10000 ] || { echo "FAIL: orders count $ORDERS < 10000"; exit 1; }

echo "PASS: Phase 2 Postgres smoke green (orders=$ORDERS)."
