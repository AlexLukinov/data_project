#!/usr/bin/env bash
# Phase 10 smoke: the Greengage (Greenplum fork) MPP layer works.
#  1) The single-host demo cluster is up with multiple primary segments.
#  2) The shop dataset is loaded and distributed across segments (distribution keys work).
#  3) A join on a non-distribution key plans a Motion node (data motion / redistribution).
# Runs against the amd64 image under emulation, so give it time. Idempotent.
set -euo pipefail
NS="${NS:-data-platform}"
POD=greengage-0

echo "== greengage statefulset ready =="
kubectl -n "$NS" rollout status statefulset/greengage --timeout=600s

# exec runs as root; psql local socket uses peer auth, so run it as the gpadmin OS user.
gp() { kubectl -n "$NS" exec "$POD" -- runuser -u gpadmin -- psql -At -d postgres -c "$1"; }

echo "== primary segments online =="
SEGS=$(gp "SELECT count(*) FROM gp_segment_configuration WHERE content >= 0 AND role='p'")
echo "  primary segments: $SEGS"
[ "${SEGS:-0}" -ge 2 ] || { echo "FAIL: expected >=2 primary segments"; exit 1; }

echo "== shop dataset loaded =="
CUST=$(gp "SELECT count(*) FROM customers")
ORD=$(gp "SELECT count(*) FROM orders")
echo "  customers=$CUST orders=$ORD"
[ "$CUST" = "1000" ] && [ "$ORD" = "10000" ] || { echo "FAIL: dataset not loaded (run 'make mpp')"; exit 1; }

echo "== distribution across segments (distribution key) =="
gp "SELECT gp_segment_id, count(*) FROM orders GROUP BY 1 ORDER BY 1"
NSEG=$(gp "SELECT count(DISTINCT gp_segment_id) FROM orders")
echo "  orders span $NSEG segments"
[ "${NSEG:-0}" -ge 2 ] || { echo "FAIL: data not distributed across segments"; exit 1; }

echo "== data motion: join on a non-distribution key plans a Motion =="
PLAN=$(gp "EXPLAIN SELECT c.city, count(*) FROM orders o JOIN customers c ON o.customer_id = c.id GROUP BY 1")
echo "$PLAN" | grep -iE 'Motion' || { echo "FAIL: no Motion node in the join plan"; echo "$PLAN"; exit 1; }
echo "$PLAN" | grep -iE 'Motion' | sed 's/^/  /'

echo "PASS: Phase 10 MPP smoke green (Greengage segments + distribution keys + data motion)."
