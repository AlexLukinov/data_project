# Pinned versions

Recorded 2026-06-11. All images verified to have **arm64** variants (Apple Silicon host).

## Host tooling

| Tool | Version |
|---|---|
| minikube | v1.38.1 |
| helm | v4.2.0 |
| kubectl (client) | v1.36.1 |
| docker | 27.5.1 |
| Kubernetes (node) | v1.35.1 (minikube default; docker runtime) |

## Charts & images (pinned)

| Component | Helm repo | Chart ver | Image : tag |
|---|---|---|---|
| MinIO | minio/minio | 5.4.0 | `quay.io/minio/minio:RELEASE.2024-12-18T13-15-44Z` |
| mc (bucket init) | — | — | `minio/mc:RELEASE.2025-08-13T08-35-41Z-cpuv1` |
| CloudNativePG | cnpg/cloudnative-pg | 0.28.3 | operator 1.29.1 (chart default) |
| Postgres (shop) | CNPG `Cluster` | — | `ghcr.io/cloudnative-pg/postgresql:16.8` |
| ClickHouse operator | altinity/altinity-clickhouse-operator | 0.27.1 | operator 0.27.x |
| ClickHouse server | CHI `clickhouse.altinity.com/v1` | — | `altinity/clickhouse-server:25.8.16.10002.altinitystable` |
| Airflow | apache-airflow/airflow | 1.16.0 (chart appVersion 2.10.5; we pin image to 2.11.1) | base `apache/airflow:2.11.1-python3.12` → `airflow-lab:dev` |
| Strimzi | strimzi/strimzi-kafka-operator | 1.0.0 | `quay.io/strimzi/operator:1.0.0`; Kafka 4.0.0; CRDs `kafka.strimzi.io/v1` |
| Kafka UI | plain manifests | — | `ghcr.io/kafbat/kafka-ui:1.5.0` |
| Event generator | plain Deployment | — | `python:3.12-slim` → `event-gen:dev` |
| Trino | trino/trino | 1.42.2 | `trinodb/trino:480` |
| Spark operator | spark-operator/spark-operator | 2.5.0 | CRD `sparkoperator.k8s.io/v1beta2` |
| Spark job image | custom | — | `apache/spark:3.5.3` + hadoop-aws 3.3.4 + aws-java-sdk-bundle 1.12.262 |

### Airflow Python libs (baked into `airflow-lab:dev`)

- Main env (with Airflow 2.11.1 / py3.12 constraints): `apache-airflow-providers-postgres`,
  `clickhouse-connect==1.2.0`, `minio==7.2.20`, `pyarrow` + `pandas` (constraint-pinned 2.x).
- Separate venv `/opt/dbt-venv`: `dbt-core~=1.10`, `dbt-clickhouse==1.10.0`.

## Why these (deltas from the original spec)

- **MinIO chart 5.4.0** — `minio/minio` chart repo archived Apr 2026; 5.4.0 is last-good.
- **CloudNativePG instead of bitnami/postgresql** — Bitnami moved free images to read-only
  `bitnamilegacy` (Aug 2025); CNPG is OSS and production-realistic.
- **Airflow 2.11.1** — last 2.x (EOL 2026-04-22); chart pinned to a 2.x-appVersion line so the
  scheduler+webserver layout is rendered (newer charts render the Airflow-3 `api-server`).
- **ClickHouse `…altinitystable`** — avoids the upstream 25.8.10+ DDL regression on fresh pods.
- **kafbat/kafka-ui** — Provectus archived its kafka-ui; kafbat is the maintained fork.
- **Strimzi 1.0.0 / Kafka 4.0** — KRaft is mandatory (no Zookeeper), CRDs are `v1`.
- **Spark operator** — moved from GoogleCloudPlatform to `kubeflow/spark-operator`.
