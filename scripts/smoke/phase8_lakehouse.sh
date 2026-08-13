#!/usr/bin/env bash
# Phase 8 smoke: the lakehouse layer works end to end.
#  1) Nessie (Iceberg REST catalog) is ready and its warehouse object-store is UP.
#  2) Trino reaches the iceberg catalog and sees the Spark-written, month-partitioned table.
#  3) Schema evolution (ALTER TABLE ADD COLUMN) works through Trino.
#  4) Time travel works through Trino the Nessie way: a Nessie TAG pins the pre-change
#     state, a second Trino catalog (iceberg_history) reads that tag, and after a write on
#     main the tag still returns the old data. Idempotent: re-running is safe.
set -euo pipefail
NS="${NS:-data-platform}"
TABLE="iceberg.shop.daily_revenue"
HIST="iceberg_history.shop.daily_revenue"
TAG="history_demo"

echo "== nessie readiness =="
kubectl -n "$NS" rollout status deploy/nessie --timeout=120s
NPOD=$(kubectl -n "$NS" get pod -l app.kubernetes.io/name=nessie -o jsonpath='{.items[0].metadata.name}')
NIP=$(kubectl -n "$NS" get pod "$NPOD" -o jsonpath='{.status.podIP}')
HEALTH=$(kubectl -n "$NS" run curl-p8-$$ --rm -i --restart=Never --image=curlimages/curl:8.11.1 --command -- \
  sh -c "curl -s http://$NIP:9000/q/health/ready" 2>/dev/null | tr -d ' \n')
echo "$HEALTH" | grep -q '"status":"DOWN"' && { echo "FAIL: a Nessie health check is DOWN"; echo "$HEALTH"; exit 1; }
echo "$HEALTH" | grep -q '"status":"UP"' || { echo "FAIL: Nessie health not reporting UP"; echo "$HEALTH"; exit 1; }
echo "  nessie health UP (incl. warehouse object-store)"

POD=$(kubectl -n "$NS" get pod -l app.kubernetes.io/name=trino,app.kubernetes.io/component=coordinator \
  -o jsonpath='{.items[0].metadata.name}')
q() { kubectl -n "$NS" exec "$POD" -- trino --server http://localhost:8080 --output-format TSV --execute "$1"; }

echo "== iceberg catalog reachable via Trino =="
q "SHOW SCHEMAS FROM iceberg" >/dev/null

echo "== table exists (written by Spark), check partitioning =="
ROWS=$(q "SELECT count(*) FROM $TABLE")
[ "$ROWS" -ge 1 ] 2>/dev/null || { echo "FAIL: $TABLE not queryable (run 'make spark-demo' first)"; exit 1; }
PARTS=$(q "SELECT count(*) FROM iceberg.shop.\"daily_revenue\$partitions\"")
echo "  $ROWS rows across $PARTS month-partitions"

echo "== schema evolution: ADD COLUMN =="
q "ALTER TABLE $TABLE ADD COLUMN IF NOT EXISTS note varchar" >/dev/null
q "DELETE FROM $TABLE WHERE note = 'smoke'" >/dev/null
q "SELECT note FROM $TABLE LIMIT 1" >/dev/null && echo "  column 'note' present"

echo "== pin current state as Nessie tag '$TAG' (delete+recreate = idempotent) =="
RC=$(kubectl -n "$NS" run curl-p8t-$$ --rm -i --restart=Never --image=curlimages/curl:8.11.1 --command -- sh -c "
NB=http://$NIP:19120/api/v2
H=\$(curl -s \$NB/trees/main | sed -n 's/.*\"hash\"[ ]*:[ ]*\"\([0-9a-f]*\)\".*/\1/p')
TH=\$(curl -s \$NB/trees/$TAG | sed -n 's/.*\"hash\"[ ]*:[ ]*\"\([0-9a-f]*\)\".*/\1/p')
[ -n \"\$TH\" ] && curl -s -o /dev/null -X DELETE \"\$NB/trees/$TAG@\$TH\"
curl -s -o /dev/null -w '%{http_code}' -X POST \"\$NB/trees?name=$TAG&type=TAG\" -H 'Content-Type: application/json' -d \"{\\\"type\\\":\\\"BRANCH\\\",\\\"name\\\":\\\"main\\\",\\\"hash\\\":\\\"\$H\\\"}\"
" 2>/dev/null)
[ "${RC:0:3}" = "200" ] || { echo "FAIL: could not (re)create Nessie tag $TAG (http=$RC)"; exit 1; }
BASE=$(q "SELECT count(*) FROM $TABLE")
echo "  tagged baseline count=$BASE"

echo "== write on main, then time-travel via the tag =="
q "INSERT INTO $TABLE (order_date, orders, revenue, note) VALUES (DATE '1970-01-01', 0, 0.0, 'smoke')" >/dev/null
NOW=$(q "SELECT count(*) FROM $TABLE")
TT=$(q "SELECT count(*) FROM $HIST")
echo "  main (iceberg)          = $NOW  (expect $((BASE+1)))"
echo "  tag  (iceberg_history)  = $TT  (expect $BASE)"

[ "$NOW" -eq "$((BASE+1))" ] || { echo "FAIL: write on main did not advance the count"; exit 1; }
[ "$TT" -eq "$BASE" ] || { echo "FAIL: time travel (tag) did not return the pre-write count"; exit 1; }

# leave the table clean so counts don't drift across runs
q "DELETE FROM $TABLE WHERE note = 'smoke'" >/dev/null

echo "PASS: Phase 8 lakehouse smoke green (Nessie REST + Iceberg via Trino: schema evolution + Nessie-tag time travel work)."
