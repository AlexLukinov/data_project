"""Batch pipeline: Postgres (shop) -> MinIO Parquet -> ClickHouse raw -> dbt marts."""
from __future__ import annotations

import io
import os
from datetime import datetime

import pandas as pd
from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook

SHOP_TABLES = ("customers", "orders", "order_items")
RAW_BUCKET = "raw"
FLOAT_COLUMNS = {"amount", "unit_price"}
DBT_DIR = "/opt/airflow/dags/dbt/shop_dwh"

# Explicit ClickHouse raw schemas; column order matches `SELECT *` from the source tables.
RAW_DDL = {
    "customers": "id Int64, name String, email String, city String, created_at DateTime64(6)",
    "orders": ("id Int64, customer_id Int64, status String, order_ts DateTime64(6), "
               "amount Float64, created_at DateTime64(6)"),
    "order_items": ("id Int64, order_id Int64, product String, quantity Int64, "
                    "unit_price Float64"),
}


def _minio_client():
    """Build a MinIO client from the connection env vars injected by the chart."""
    from minio import Minio
    return Minio(os.environ["MINIO_ENDPOINT"],
                 access_key=os.environ["MINIO_ACCESS_KEY"],
                 secret_key=os.environ["MINIO_SECRET_KEY"], secure=False)


def extract_to_minio(ds: str, **_) -> None:
    """Snapshot each shop table to a Parquet object in MinIO under dt=<ds>."""
    engine = PostgresHook(postgres_conn_id="shop_pg").get_sqlalchemy_engine()
    client = _minio_client()
    for table in SHOP_TABLES:
        df = pd.read_sql(f"SELECT * FROM {table}", engine)  # lab: full snapshot per run
        for col in FLOAT_COLUMNS & set(df.columns):
            df[col] = df[col].astype(float)
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        buf.seek(0)
        client.put_object(RAW_BUCKET, f"shop/{table}/dt={ds}/data.parquet",
                          buf, length=buf.getbuffer().nbytes)


def load_raw_to_clickhouse(ds: str, **_) -> None:
    """Create raw.<table> if needed and replace its dt=<ds> partition from the MinIO Parquet."""
    import clickhouse_connect
    client = clickhouse_connect.get_client(
        host=os.environ["CLICKHOUSE_HOST"], port=int(os.environ["CLICKHOUSE_PORT"]),
        username=os.environ["CLICKHOUSE_USER"], password=os.environ["CLICKHOUSE_PASSWORD"])
    endpoint = os.environ["MINIO_ENDPOINT"]
    ak, sk = os.environ["MINIO_ACCESS_KEY"], os.environ["MINIO_SECRET_KEY"]
    for table, cols in RAW_DDL.items():
        client.command(f"CREATE TABLE IF NOT EXISTS raw.{table} ({cols}, _dt Date) "
                       f"ENGINE = MergeTree PARTITION BY _dt ORDER BY id")
        client.command(f"ALTER TABLE raw.{table} DROP PARTITION '{ds}'")  # idempotent re-run
        url = f"http://{endpoint}/raw/shop/{table}/dt={ds}/data.parquet"
        # use_hive_partitioning=0: the dt=<ds> path segment must NOT be parsed as a
        # hive partition column (we add _dt explicitly below).
        client.command(f"INSERT INTO raw.{table} "
                       f"SELECT *, toDate('{ds}') FROM s3('{url}', '{ak}', '{sk}', 'Parquet') "
                       f"SETTINGS use_hive_partitioning = 0")


with DAG(
    dag_id="shop_batch_pipeline",
    description="Postgres -> MinIO Parquet -> ClickHouse raw -> dbt marts",
    start_date=datetime(2026, 1, 1),
    schedule="@daily",
    catchup=False,
    tags=["lab", "batch"],
) as dag:
    extract = PythonOperator(task_id="extract_to_minio", python_callable=extract_to_minio)
    load = PythonOperator(task_id="load_raw_to_clickhouse", python_callable=load_raw_to_clickhouse)
    dbt_build = BashOperator(
        task_id="dbt_build",
        bash_command=(f"/opt/dbt-venv/bin/dbt build "
                      f"--project-dir {DBT_DIR} --profiles-dir {DBT_DIR}"),
    )
    extract >> load >> dbt_build
