#!/usr/bin/env bash
# Phase 0 smoke: cluster node Ready + metrics-server Running + namespace present.
set -euo pipefail
PROFILE="${PROFILE:-dataplatform}"
NS="${NS:-data-platform}"

echo "== node readiness =="
kubectl get nodes
READY="$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}')"
[ "$READY" = "True" ] || { echo "FAIL: node not Ready"; exit 1; }

echo "== namespace =="
kubectl get ns "$NS" >/dev/null || { echo "FAIL: namespace $NS missing"; exit 1; }

echo "== metrics-server =="
kubectl -n kube-system rollout status deploy/metrics-server --timeout=120s

echo "PASS: Phase 0 cluster smoke green."
