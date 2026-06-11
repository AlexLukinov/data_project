#!/usr/bin/env bash
# Start the minikube cluster for the data platform lab. Idempotent: re-running is safe.
set -euo pipefail

PROFILE="${PROFILE:-dataplatform}"
CPUS="${CPUS:-4}"
MEMORY="${MEMORY:-12288}"   # MiB — needs Docker Desktop allocated >= 16GB
DISK="${DISK:-40g}"
NS="${NS:-data-platform}"

echo "==> Preflight: required tools"
for bin in minikube kubectl helm docker; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: '$bin' not found on PATH. Install it before running." >&2
    exit 1
  fi
  printf "  %-9s %s\n" "$bin" "$("$bin" version --short 2>/dev/null || "$bin" --version 2>/dev/null | head -1)"
done

# Guard: Docker must have enough memory to host a 12Gi minikube node.
DOCKER_MEM_BYTES="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
DOCKER_MEM_MIB=$(( DOCKER_MEM_BYTES / 1024 / 1024 ))
NEED_MIB=$(( MEMORY + 1024 ))
echo "==> Docker Desktop memory: ${DOCKER_MEM_MIB}Mi (need >= ${NEED_MIB}Mi for --memory=${MEMORY})"
if [ "$DOCKER_MEM_MIB" -lt "$NEED_MIB" ]; then
  echo "ERROR: Docker Desktop has only ${DOCKER_MEM_MIB}Mi. Raise it to >=16GB in" >&2
  echo "       Docker Desktop → Settings → Resources → Memory, then re-run." >&2
  exit 1
fi

echo "==> Starting minikube (profile=${PROFILE}, ${CPUS}cpu/${MEMORY}Mi/${DISK})"
minikube start \
  --profile "$PROFILE" \
  --driver=docker \
  --cpus="$CPUS" \
  --memory="$MEMORY" \
  --disk-size="$DISK"

echo "==> Enabling addons"
minikube addons enable metrics-server --profile "$PROFILE"

echo "==> Pointing kubectl at the profile"
kubectl config use-context "$PROFILE"

echo "==> Creating namespace ${NS}"
kubectl apply -f "$(dirname "$0")/../infra/namespace.yaml"
kubectl config set-context --current --namespace="$NS"

echo "==> Applying lab secrets"
kubectl apply -f "$(dirname "$0")/../infra/secrets.yaml"

echo "==> Cluster ready."
kubectl get nodes
