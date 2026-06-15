#!/usr/bin/env bash
# Phase 1 smoke: MinIO up, bucket-init Job complete, 4 buckets present, smoke object readable.
set -euo pipefail
NS="${NS:-data-platform}"
MC_IMAGE="minio/mc:RELEASE.2025-08-13T08-35-41Z-cpuv1"

echo "== minio pods =="
kubectl -n "$NS" rollout status deploy/minio --timeout=120s 2>/dev/null \
  || kubectl -n "$NS" rollout status statefulset/minio --timeout=120s

echo "== bucket-init job (TTL may have GC'd it after completion) =="
if kubectl -n "$NS" get job/minio-bucket-init >/dev/null 2>&1; then
  kubectl -n "$NS" wait --for=condition=complete job/minio-bucket-init --timeout=120s
else
  echo "  job already garbage-collected (ttlSecondsAfterFinished) — verifying buckets directly"
fi

U=$(kubectl -n "$NS" get secret minio-root -o jsonpath='{.data.rootUser}' | base64 -d)
P=$(kubectl -n "$NS" get secret minio-root -o jsonpath='{.data.rootPassword}' | base64 -d)

echo "== bucket listing (via throwaway mc pod) =="
OUT=$(kubectl -n "$NS" run mc-smoke-$$ --rm -i --restart=Never --image="$MC_IMAGE" \
  --env="MC_HOST_local=http://$U:$P@minio:9000" --command -- \
  sh -c 'mc ls local; echo "---SMOKE---"; mc cat local/raw/_smoke/smoke.csv' 2>/dev/null)
echo "$OUT"

for b in raw staging dwh spark; do
  echo "$OUT" | grep -q " $b/" || { echo "FAIL: bucket '$b' missing"; exit 1; }
done
echo "$OUT" | grep -q "1,alpha" || { echo "FAIL: smoke.csv content missing"; exit 1; }

echo "PASS: Phase 1 MinIO smoke green (4 buckets + smoke object)."
