# Data Platform Lab — the contract. All targets are idempotent.
# Profiles: core (minio,postgres,clickhouse,airflow,dbt) | streaming | query | spark
.DEFAULT_GOAL := help

PROFILE ?= dataplatform
NS      ?= data-platform
KUBE    := kubectl -n $(NS)
HELM    := helm

# Pinned chart versions (see docs/versions.md)
MINIO_CHART_VER   ?= 5.4.0
CNPG_CHART_VER    ?= 0.28.3
CH_OP_CHART_VER   ?= 0.27.1
AIRFLOW_CHART_VER ?= 1.16.0
STRIMZI_CHART_VER ?= 1.0.0
TRINO_CHART_VER   ?= 1.42.2
SPARK_CHART_VER   ?= 2.5.0

SCHED_POD = $$($(KUBE) get pod -l component=scheduler -o jsonpath='{.items[0].metadata.name}')

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── repos ────────────────────────────────────────────────────────────────────
.PHONY: repos
repos: ## Add/update all helm repos
	$(HELM) repo add minio https://charts.min.io >/dev/null 2>&1 || true
	$(HELM) repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null 2>&1 || true
	$(HELM) repo add altinity https://helm.altinity.com >/dev/null 2>&1 || true
	$(HELM) repo add apache-airflow https://airflow.apache.org >/dev/null 2>&1 || true
	$(HELM) repo add strimzi https://strimzi.io/charts >/dev/null 2>&1 || true
	$(HELM) repo add trino https://trinodb.github.io/charts >/dev/null 2>&1 || true
	$(HELM) repo add spark-operator https://kubeflow.github.io/spark-operator >/dev/null 2>&1 || true
	$(HELM) repo update >/dev/null

# ── phase 0 ──────────────────────────────────────────────────────────────────
.PHONY: cluster
cluster: ## Start minikube (4cpu/12Gi/40g) + metrics-server + namespace
	bash cluster/up.sh

# ── core (phases 1–5) ────────────────────────────────────────────────────────
.PHONY: core
core: repos minio postgres clickhouse airflow ## Phases 1–5: full batch path
	@echo ">> core profile installed. Run: make sync-dags && make smoke"

.PHONY: minio
minio: ## Phase 1: MinIO + bucket-init job
	$(HELM) upgrade --install minio minio/minio --version $(MINIO_CHART_VER) \
	  -n $(NS) -f infra/minio/values.yaml
	$(KUBE) apply -f infra/minio/bucket-init-job.yaml
	$(KUBE) wait --for=condition=complete job/minio-bucket-init --timeout=180s

.PHONY: postgres
postgres: ## Phase 2: CloudNativePG operator + shop cluster (seeded)
	$(HELM) upgrade --install cnpg cnpg/cloudnative-pg --version $(CNPG_CHART_VER) \
	  -n cnpg-system --create-namespace --wait
	$(KUBE) apply -f infra/postgres-shop/seed-configmap.yaml
	$(KUBE) apply -f infra/postgres-shop/cluster.yaml
	$(KUBE) wait --for=condition=Ready cluster/shop-db --timeout=300s

.PHONY: clickhouse
clickhouse: ## Phase 3: Altinity operator + CHI + bootstrap SQL
	$(HELM) upgrade --install clickhouse-operator altinity/altinity-clickhouse-operator \
	  --version $(CH_OP_CHART_VER) -n $(NS) --wait
	$(KUBE) apply -f infra/clickhouse/chi.yaml
	@echo "waiting for clickhouse pod to be created by the operator..."
	@for i in $$(seq 1 60); do \
	  $(KUBE) get pod -l clickhouse.altinity.com/chi=platform 2>/dev/null | grep -q chi && break || sleep 5; \
	done
	$(KUBE) wait --for=condition=Ready pod -l clickhouse.altinity.com/chi=platform --timeout=300s
	bash infra/clickhouse/bootstrap.sh

.PHONY: airflow-image
airflow-image: ## Build the custom airflow-lab:dev image into minikube
	minikube image build -t airflow-lab:dev infra/airflow/ -p $(PROFILE)

.PHONY: airflow
airflow: airflow-image ## Phase 4: Airflow (LocalExecutor) + batch DAG
	$(KUBE) apply -f infra/airflow/airflow-meta.yaml
	$(KUBE) wait --for=condition=Ready cluster/airflow-meta --timeout=300s
	$(HELM) upgrade --install airflow apache-airflow/airflow --version $(AIRFLOW_CHART_VER) \
	  -n $(NS) -f infra/airflow/values.yaml --timeout 12m
	@echo ">> Airflow up. Run: make sync-dags"

.PHONY: sync-dags
sync-dags: ## Copy dags/ and dbt/ into the Airflow dags PVC via the scheduler pod
	$(KUBE) exec $(SCHED_POD) -c scheduler -- mkdir -p /opt/airflow/dags/dbt
	$(KUBE) cp dags/. $(SCHED_POD):/opt/airflow/dags/ -c scheduler
	$(KUBE) cp dbt/.  $(SCHED_POD):/opt/airflow/dags/dbt/ -c scheduler
	@echo ">> synced dags/ and dbt/ to scheduler PVC"

# ── streaming (phase 6) ──────────────────────────────────────────────────────
.PHONY: streaming
streaming: repos ## Phase 6: Strimzi + Kafka (KRaft) + kafka-ui + CH kafka tables
	$(HELM) upgrade --install strimzi strimzi/strimzi-kafka-operator \
	  --version $(STRIMZI_CHART_VER) -n $(NS) --wait
	$(KUBE) apply -f infra/kafka/kafka.yaml
	$(KUBE) wait --for=condition=Ready kafka/platform --timeout=300s
	$(KUBE) apply -f infra/kafka/topic.yaml
	$(KUBE) apply -f infra/kafka/kafka-ui.yaml
	minikube image build -t event-gen:dev generator/ -p $(PROFILE)
	$(KUBE) apply -f generator/deployment.yaml
	bash infra/clickhouse/kafka-tables.sh
	@echo ">> streaming installed. Run: make stream-on"

.PHONY: stream-on
stream-on: ## Scale the event generator to 1
	$(KUBE) scale deploy/event-gen --replicas=1

.PHONY: stream-off
stream-off: ## Scale the event generator to 0
	$(KUBE) scale deploy/event-gen --replicas=0

# ── query (phase 7a) ─────────────────────────────────────────────────────────
.PHONY: query
query: repos ## Phase 7a: Trino (coordinator-only) + clickhouse catalog
	$(HELM) upgrade --install trino trino/trino --version $(TRINO_CHART_VER) \
	  -n $(NS) -f infra/trino/values.yaml --wait
	@echo ">> trino up"

# ── spark (phase 7b) ─────────────────────────────────────────────────────────
.PHONY: spark-demo
spark-demo: repos ## Phase 7b: spark operator + run the demo SparkApplication once
	$(HELM) upgrade --install spark-operator spark-operator/spark-operator \
	  --version $(SPARK_CHART_VER) -n spark-operator --create-namespace \
	  --set "spark.jobNamespaces={$(NS)}" --wait
	minikube image build -t spark-s3a:dev infra/spark/ -p $(PROFILE)
	$(KUBE) apply -f infra/spark/rbac.yaml
	$(KUBE) delete sparkapplication shop-daily-revenue -n $(NS) --ignore-not-found
	$(KUBE) apply -f infra/spark/sparkapplication.yaml
	@echo ">> SparkApplication submitted. Watch: kubectl -n $(NS) get sparkapplication -w"

# ── lakehouse (phase 8) ──────────────────────────────────────────────────────
.PHONY: lakehouse
lakehouse: ## Phase 8: Nessie (Iceberg REST catalog) over the MinIO 'lakehouse' bucket
	$(KUBE) apply -f infra/lakehouse/nessie.yaml
	$(KUBE) rollout status deploy/nessie --timeout=180s
	@echo ">> nessie up. 'make query' exposes it as the trino 'iceberg' catalog;"
	@echo "   'make spark-demo' writes a partitioned Iceberg table into it."

# ── cdc (phase 9) ────────────────────────────────────────────────────────────
.PHONY: cdc
cdc: ## Phase 9: Debezium CDC (Strimzi Connect) -> Kafka -> Airflow -> ClickHouse staging
	$(KUBE) exec -i shop-db-1 -- psql -U postgres -d shop -v ON_ERROR_STOP=1 < infra/cdc/setup-postgres-cdc.sql
	minikube image build -t kafka-connect-debezium:dev infra/cdc/ -p $(PROFILE)
	$(KUBE) apply -f infra/cdc/kafka-connect.yaml
	$(KUBE) wait kafkaconnect/debezium --for=condition=Ready --timeout=300s
	$(KUBE) apply -f infra/cdc/debezium-connector.yaml
	$(KUBE) wait kafkaconnector/shop-postgres --for=condition=Ready --timeout=180s
	@echo ">> CDC live. Consumer needs confluent-kafka: 'make airflow && make sync-dags',"
	@echo "   then run it: airflow dags trigger shop_cdc_consumer (or 'make smoke')."

# ── mpp (phase 10) ───────────────────────────────────────────────────────────
.PHONY: mpp
mpp: ## Phase 10: single-host Greengage (Greenplum fork, amd64 emulated) + shop dataset
	docker build --platform linux/amd64 -t greengage-demo:dev infra/greengage/   # amd64: build on host
	minikube -p $(PROFILE) image load greengage-demo:dev                          # then load into the node
	$(KUBE) apply -f infra/greengage/greengage.yaml
	$(KUBE) rollout status statefulset/greengage --timeout=600s
	$(KUBE) exec -i greengage-0 -- runuser -u gpadmin -- psql -d postgres -v ON_ERROR_STOP=1 < infra/greengage/seed.sql
	@echo ">> Greengage seeded. Show data motion:"
	@echo "   kubectl -n $(NS) exec greengage-0 -- psql -d postgres -c \\"
	@echo "     'EXPLAIN SELECT c.city,count(*) FROM orders o JOIN customers c ON o.customer_id=c.id GROUP BY 1'"

# ── data quality (phase 11) ──────────────────────────────────────────────────
.PHONY: dq
dq: ## Phase 11: run dbt data-quality tests (not_null / unique / relationships)
	$(KUBE) exec $(SCHED_POD) -c scheduler -- /opt/dbt-venv/bin/dbt test \
	  --project-dir /opt/airflow/dags/dbt/shop_dwh --profiles-dir /opt/airflow/dags/dbt/shop_dwh

# ── ops ──────────────────────────────────────────────────────────────────────
.PHONY: smoke
smoke: ## Run smoke tests for every installed component
	@for s in scripts/smoke/*.sh; do echo "=== $$s ==="; bash "$$s" || exit 1; done

.PHONY: urls
urls: ## Print access URLs + credentials
	@cat scripts/access-table.txt 2>/dev/null || echo "run 'make urls' after scripts are created"

.PHONY: port-forward
port-forward: ## Start all port-forwards in the background
	bash scripts/port-forwards.sh

.PHONY: down
down: ## Scale every workload to zero (keep PVCs/data)
	-$(KUBE) scale deploy --all --replicas=0
	-$(KUBE) scale statefulset --all --replicas=0
	@echo ">> scaled to zero. PVCs preserved. 'make core'/'make streaming' to bring back."

.PHONY: nuke
nuke: ## DESTRUCTIVE full teardown (typed confirmation required)
	@echo "!! This DELETES the '$(PROFILE)' minikube cluster and ALL data (PVCs)."
	@read -p "Type 'nuke $(PROFILE)' to confirm: " ans; \
	  if [ "$$ans" = "nuke $(PROFILE)" ]; then minikube delete -p $(PROFILE); \
	  else echo "aborted."; fi
