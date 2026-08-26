#!/usr/bin/env bash
# Resume the lab: start the minikube node (also fixes a stale kubeconfig), wait for the
# core pods to pass readiness, then restore ALL host port-forwards. Idempotent.
set -uo pipefail
PROFILE="${PROFILE:-dataplatform}"
NS="${NS:-data-platform}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ">> Starting minikube profile '$PROFILE' (reuses saved cpu/mem; fixes kubeconfig)..."
minikube start -p "$PROFILE"

echo ">> Waiting for the node to be Ready..."
kubectl wait --for=condition=ready node --all --timeout=180s || true

wait_ready() { # pod-name — wait for a pod's readiness, tolerate its absence
  local pod="$1"
  if kubectl -n "$NS" get "pod/$pod" >/dev/null 2>&1; then
    printf "   %-32s " "$pod"
    if kubectl -n "$NS" wait --for=condition=ready "pod/$pod" --timeout=180s >/dev/null 2>&1; then
      echo "ready"
    else
      echo "NOT ready — check with: kubectl -n $NS get pods"
    fi
  fi
}

echo ">> Waiting for core pods (readiness probes take ~1-2 min after a restart)..."
wait_ready chi-platform-platform-0-0-0
wait_ready shop-db-1

echo ">> Restoring port-forwards..."
bash "$HERE/port-forwards.sh"

echo ">> Resumed. If DBeaver still can't connect, give ClickHouse another ~30s and retry."
