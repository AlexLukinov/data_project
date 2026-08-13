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
| Strimzi | strimzi/strimzi-kafka-operator | 1.0.0 | `quay.io/strimzi/operator:1.0.0`; Kafka 4.2.0 (op 1.0.0 supports 4.1.x–4.2.0); CRDs `kafka.strimzi.io/v1` |
| Kafka UI | plain manifests | — | `ghcr.io/kafbat/kafka-ui:v1.0.0` |
| Event generator | plain Deployment | — | `python:3.12-slim` → `event-gen:dev` |
| Trino | trino/trino | 1.42.2 | `trinodb/trino:480` |
| Spark operator | spark-operator/spark-operator | 2.5.0 | CRD `sparkoperator.k8s.io/v1beta2` |
| Spark job image | custom | — | `apache/spark:3.5.3` + JDK 17 + hadoop-aws 3.3.4 + aws-java-sdk-bundle 1.12.262 + iceberg-spark-runtime-3.5_2.12 1.11.0 + iceberg-aws-bundle 1.11.0 |
| Nessie (Iceberg REST catalog) | plain Deployment | — | `ghcr.io/projectnessie/nessie:0.108.4` (RocksDB store on PVC) |
| Kafka Connect (Debezium) | Strimzi `KafkaConnect` | — | `quay.io/strimzi/kafka:1.0.0-kafka-4.2.0` + Debezium PG connector 3.1.1.Final → `kafka-connect-debezium:dev` |
| plugin downloader stage | — | — | `alpine:3.21` (build-time only) |
| Greengage (MPP) | plain StatefulSet | — | `greengagedb/ggdb7_ubuntu:7.5.0` (**amd64-only, runs emulated**) → `greengage-demo:dev` |
| smoke curl image | — | — | `curlimages/curl:8.11.1` |

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

## Phase 8 — lakehouse (Iceberg + Nessie)

- **Nessie 0.108.4 as the Iceberg REST catalog** — both Trino and Spark speak the standard
  Iceberg REST API to it; Nessie writes table metadata to MinIO server-side, so it holds the
  MinIO creds (via a `urn:nessie-secret:quarkus:…` reference; `SMALLRYE_CONFIG_MAPPING_VALIDATE_UNKNOWN=false`
  lets the secret-map values arrive as JVM system properties). Health lives on the Quarkus
  **mgmt port 9000**, not 19120. Version store is **RocksDB** on a PVC (survives `make down`).
- **Iceberg 1.11.0 needs Java 17** — the arm64 `apache/spark:*-java17-*` images actually ship
  Java 11, so the Spark image installs `openjdk-17-jre-headless` and points `JAVA_HOME` at it.
- **Time travel is Nessie-native (git-style)** — Nessie keeps history as commits/branches/tags,
  not as retained Iceberg snapshots, so `FOR VERSION AS OF <snapshot>` does not apply. Instead a
  Nessie **tag** pins a point-in-time state and a second Trino catalog (`iceberg_history`, native
  `nessie` type) reads it; the phase-8 smoke proves old-vs-new through Trino SQL.

## Phase 9 — CDC (Debezium)

- **Debezium PG connector 3.1.1.Final on Strimzi Kafka Connect 4.2.0** — a custom Connect image
  bakes the connector plugin (built via a multi-stage `alpine` downloader, no reliance on tools in
  the Strimzi base). Connector managed declaratively as a `KafkaConnector` CR.
- **shop-db needs no wal_level change** — CNPG already runs `wal_level=logical`; CDC setup only
  grants `shop` REPLICATION and creates publication `dbz_publication` (see `infra/cdc/setup-postgres-cdc.sql`).
- **Strimzi 1.0.0 promoted `groupId`/`*StorageTopic`** from `spec.config` to first-class
  `KafkaConnect` spec fields.
- **Connect memory** — a 1Gi limit OOM-kills the worker mid-snapshot (re-snapshot loop); bumped to
  2Gi limit / 1Gi request with `-Xmx 1024m` for off-heap headroom.
- **Idempotent landing** — the Airflow `shop_cdc_consumer` DAG (confluent-kafka, added to the image)
  writes into `staging.cdc_events`, a `ReplacingMergeTree(_version)` keyed by `(source_table, id)`;
  duplicate deliveries collapse to the latest version, so the deduped state matches the source.

## Phase 10 — MPP (Greengage)

- **⚠️ Greengage is amd64-only** — no arm64 image exists (all `greengagedb/ggdbN_*` tags are amd64),
  which breaks the stand's "all images arm64" rule. It runs here **under Docker Desktop's amd64
  emulation** (deliberate, documented exception): functional but slow. Single-host demo cluster
  (1 coordinator + 2 primary segments, no mirrors) via the source-tree `gpdemo` (`demo_cluster.sh`,
  which needs no ssh) inside one pod, data on a PVC.
- **Image quirks** — the base ships GPHOME as a tarball and has **no gpadmin user**; the Dockerfile
  creates gpadmin and extracts GPHOME. Greengage renamed `greenplum_path.sh` → **`greengage_path.sh`**.
- **Concept demonstrated** — `orders` and `customers` are distributed by different keys, so a join on
  `customer_id` plans a **Motion** node (redistribute/broadcast) — the phase-10 smoke asserts segment
  distribution + a Motion in the plan.
