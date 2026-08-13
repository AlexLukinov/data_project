#!/usr/bin/env bash
# Phase 11 smoke: the dbt data-quality tests on the staging + marts models all pass
# (not_null / unique / relationships / accepted_values). Runs inside the Airflow dbt venv.
set -euo pipefail
NS="${NS:-data-platform}"
SCHED=$(kubectl -n "$NS" get pod -l component=scheduler -o jsonpath='{.items[0].metadata.name}')
DBT=/opt/dbt-venv/bin/dbt
DIR=/opt/airflow/dags/dbt/shop_dwh

echo "== dbt test (staging + marts) =="
OUT=$(kubectl -n "$NS" exec "$SCHED" -c scheduler -- "$DBT" test --project-dir "$DIR" --profiles-dir "$DIR" 2>&1)
echo "$OUT" | grep -E 'Done\. PASS=' | tail -1

echo "$OUT" | grep -qE 'ERROR=0' || { echo "FAIL: dbt tests reported errors"; echo "$OUT" | tail -25; exit 1; }
PASS=$(echo "$OUT" | grep -oE 'PASS=[0-9]+' | head -1 | cut -d= -f2)
[ "${PASS:-0}" -ge 1 ] || { echo "FAIL: no dbt tests ran"; exit 1; }

echo "PASS: Phase 11 data-quality smoke green ($PASS dbt tests passed, 0 errors)."
