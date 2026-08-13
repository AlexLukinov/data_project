# Custom Airflow image for the lab.
#  - main env: postgres provider + ingestion libs, pinned via Airflow's own constraints
#    so the shared dependency set (pandas, pyarrow, ...) stays consistent with Airflow core.
#  - dbt lives in an ISOLATED venv: dbt-core pins click/jinja2/etc. that clash with Airflow.
FROM apache/airflow:2.11.1-python3.12

ARG AIRFLOW_VERSION=2.11.1
ARG PYTHON_VERSION=3.12
ARG CONSTRAINTS="https://raw.githubusercontent.com/apache/airflow/constraints-${AIRFLOW_VERSION}/constraints-${PYTHON_VERSION}.txt"

# Ingestion stack (governed by Airflow constraints for a reproducible, conflict-free set)
RUN pip install --no-cache-dir --constraint "${CONSTRAINTS}" \
      apache-airflow-providers-postgres \
      clickhouse-connect \
      confluent-kafka \
      minio \
      pyarrow \
      pandas

# dbt in its own venv. BashOperator invokes /opt/dbt-venv/bin/dbt.
USER root
RUN python -m venv /opt/dbt-venv \
 && /opt/dbt-venv/bin/pip install --no-cache-dir dbt-clickhouse==1.10.0 \
 && chown -R airflow: /opt/dbt-venv
USER airflow
