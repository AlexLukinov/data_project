# Data Platform Lab — conventions for Claude Code sessions

A laptop-scale, production-realistic miniature of a Russian DE/DWH stack on minikube,
used for Data Engineer interview prep. Read this before touching anything.

## Golden rules

1. **Never proceed past a failing smoke test.** Each phase has `scripts/smoke/<phase>.sh`.
   Run it, show output, only then commit and move on.
2. **Never tear down without explicit confirmation.** No `minikube delete`, no PVC deletion,
   no `make nuke` unless the user types the confirmation. `make down` (scale to zero) is safe.
3. **Everything idempotent:** `helm upgrade --install`, `kubectl apply`. Re-running any phase is safe.
4. **Pin every version.** Charts and images are pinned; record them in `docs/versions.md`.
5. **One git commit per green phase.** Conventional commits (`feat:`, `chore:`, ...).

## Cluster facts

- minikube profile: `dataplatform` · namespace: `data-platform`
- CNPG operator namespace: `cnpg-system`
- Driver: docker · 4 CPU / 12288Mi / 40g disk (needs Docker Desktop ≥16GB on this Mac)
- Host is **arm64** (Apple Silicon) — all images must have arm64 variants.

## Naming conventions

- ClickHouse: CHI name `platform` → HTTP service `clickhouse-platform.data-platform.svc:8123`
  (never port-forward CH native 9000 — it collides with MinIO API 9000).
- Kafka: Kafka CR name `platform` → bootstrap `platform-kafka-bootstrap.data-platform.svc:9092`.
- Postgres (CNPG): Cluster `shop-db` → RW service `shop-db-rw.data-platform.svc:5432`.
- MinIO: service `minio.data-platform.svc:9000` (API), console 9001.

## Where things live

- Helm values + manifests: `infra/<component>/`
- DAGs: `dags/` · dbt project: `dbt/shop_dwh/` · event generator: `generator/`
- Cluster bootstrap: `cluster/up.sh` · smoke tests: `scripts/smoke/`
- Lab credentials: `infra/secrets.yaml` (lab-only admin/admin-style; intentionally committed).
- Docs: `docs/ARCHITECTURE.md`, `docs/versions.md`.

## The make-target contract

| Target | Does |
|---|---|
| `make cluster` | start minikube (4cpu/12Gi/40g) + metrics-server + namespace |
| `make core` | phases 1–5: minio, postgres, clickhouse, airflow, dbt wiring |
| `make streaming` | phase 6: strimzi, kafka, kafka-ui, CH kafka tables |
| `make stream-on` / `stream-off` | scale event generator 1 / 0 |
| `make query` | phase 7a: trino |
| `make spark-demo` | phase 7b: spark operator + run demo once |
| `make sync-dags` | copy `dags/` and `dbt/` into the Airflow PVC |
| `make urls` | print access URLs + credentials table |
| `make smoke` | run all smoke tests for installed components |
| `make down` | scale everything to zero (keep PVCs) |
| `make nuke` | full teardown (prints warning, requires typed confirmation) |

## Resource budget (requests)

| Component | Requests | Profile |
|---|---|---|
| MinIO | 512Mi | core |
| Postgres (CNPG, shop) | 256Mi | core |
| ClickHouse (1×1) | 1Gi (limit 2Gi) | core |
| Airflow (scheduler+web+meta-PG) | ~2Gi | core |
| Strimzi + Kafka (1) + kafka-ui | ~1.5Gi | streaming |
| Event generator | 128Mi | streaming |
| Trino (coordinator-only) | 1Gi | query |
| Spark operator + demo | on-demand | spark |

Core ≈ 4.5–5Gi · core+streaming ≈ 6.5Gi.

## Stack-specific gotchas (do not relearn the hard way)

- **Airflow chart must default to a 2.x appVersion** (scheduler+webserver layout). Newer charts
  (~1.22) render the Airflow-3 `api-server` and break 2.11. Verify with `helm show chart`.
- **dbt lives in its own venv** in the Airflow image (`/opt/dbt-venv`); its deps clash with Airflow's.
- **pandas pinned to 2.x** (Airflow 2.11 constraints) — not pandas 3.0.
- **ClickHouse image** must be the `…altinitystable` tag (avoids upstream 25.8.10+ DDL regression).
- **CNPG uses its own postgres image** (UID 26) — never swap in official `postgres`.
- **MinIO s3** from ClickHouse uses path-style http URLs (`http://minio…:9000/bucket/key`).
