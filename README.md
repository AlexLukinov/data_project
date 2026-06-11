# Data Platform Lab

A laptop-scale, production-realistic miniature of a Russian DE/DWH stack on minikube —
**ClickHouse + Airflow + dbt + Kafka + MinIO + Postgres** (+ optional Trino / Spark) wired
into one end-to-end pipeline. Built for Data Engineer interview prep.

```
BATCH:      Postgres (shop)  ──Airflow──►  MinIO (Parquet)  ──s3()──►  ClickHouse raw
                                                                          │ dbt build
                                                                          ▼
                                                                   staging → marts
STREAMING:  event-gen ──► Kafka (Strimzi/KRaft) ──Kafka engine + MV──► ClickHouse raw.events
QUERY:      Trino ──jdbc──► ClickHouse marts        SPARK: s3a job ──► MinIO spark/output
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full diagram and integration notes.

## Prerequisites

- Docker Desktop with **≥ 16 GB** allocated (Settings → Resources → Memory). minikube takes 12 GB.
- `minikube`, `kubectl`, `helm` on PATH (`brew install minikube helm kubernetes-cli`).
- Apple Silicon / arm64 supported (all images are multi-arch).

## Quickstart (zero → batch path)

```bash
make cluster        # start minikube (4cpu / 12Gi / 40g) + metrics-server + namespace
make core           # phases 1–5: MinIO, Postgres, ClickHouse, Airflow, dbt
make sync-dags      # push dags/ + dbt/ into the Airflow PVC
make smoke          # verify every installed component
make urls           # print access table
bash scripts/port-forwards.sh   # open the consoles
```

Then trigger the batch pipeline from the Airflow UI (or `airflow dags trigger shop_batch_pipeline`).

Add the streaming path:

```bash
make streaming      # Strimzi + Kafka (KRaft) + kafka-ui + ClickHouse Kafka tables
make stream-on      # start the event generator (make stream-off to stop)
```

Optional profiles (more memory):

```bash
make query          # Trino coordinator-only, clickhouse + tpch catalogs
make spark-demo     # run a PySpark s3a job once
```

## Access

| Service | Local URL | Credentials |
|---|---|---|
| MinIO console | http://localhost:9001 | minioadmin / minioadmin |
| MinIO API | http://localhost:9002 (→ 9000) | minioadmin / minioadmin |
| Airflow | http://localhost:8080 | admin / admin |
| ClickHouse HTTP | http://localhost:8123 | admin / admin |
| Kafka UI | http://localhost:8081 | — |
| Trino | http://localhost:8082 | any username |
| Postgres shop | localhost:5433 (→ 5432) | shop / shop |

> ClickHouse native port 9000 collides with MinIO API 9000 on the host — do **not** port-forward
> CH native; use HTTP 8123. Lab credentials live in `infra/secrets.yaml`.

## Teardown

```bash
make down           # scale all workloads to zero, keep PVCs (data preserved)
make nuke           # DESTRUCTIVE: delete the cluster (typed confirmation required)
```

## Advanced exercises (interview talking points)

- **KubernetesExecutor** instead of LocalExecutor: DAG distribution, pod templates, per-task
  resources. (This lab uses LocalExecutor for footprint.)
- **Airflow 3.x migration**: Task SDK, separate API server + dag-processor, task isolation.
  (This lab pins Airflow 2.11.1, still the production-dominant line.)
- Add **Keeper** + a 2nd ClickHouse replica; add a Hive/Iceberg catalog for Trino.

## Repo layout

`infra/` Helm values + manifests per component · `dags/` Airflow DAGs · `dbt/shop_dwh/` dbt
project · `generator/` Kafka producer · `scripts/smoke/` per-phase smoke tests · `docs/`.
Conventions for future work: [CLAUDE.md](CLAUDE.md). Pinned versions: [docs/versions.md](docs/versions.md).
