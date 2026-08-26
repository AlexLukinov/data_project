#!/usr/bin/env bash
# Gracefully pause the lab: stop host port-forwards, then stop the minikube node.
# Safe + reversible — keeps every PVC and all data. Resume with scripts/resume.sh.
# Use this instead of stopping the Docker container directly (that leaves the k8s
# control plane down and stales the kubeconfig).
set -uo pipefail
PROFILE="${PROFILE:-dataplatform}"

echo ">> Stopping host port-forwards..."
if pkill -f "kubectl.*port-forward" 2>/dev/null; then
  echo "   port-forwards stopped"
else
  echo "   none were running"
fi

echo ">> Stopping minikube profile '$PROFILE' (data/PVCs are kept)..."
minikube stop -p "$PROFILE"

echo ">> Paused. Resume with: bash scripts/resume.sh"
