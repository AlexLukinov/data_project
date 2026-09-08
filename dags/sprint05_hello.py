"""Sprint 5 — first hand-written DAG: parse time vs run time, and the data interval."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator

log = logging.getLogger(__name__)

SECONDS_PER_MINUTE = 60

# Re-evaluated on EVERY import of this file, and this file is imported constantly:
#   1. by the scheduler's DagFileProcessor, every `min_file_process_interval` (30s here);
#   2. again inside each task subprocess -- LocalExecutor forks `airflow tasks run`, which
#      re-imports the module to reach the task object (hence the ~0s age in the task log).
# That is why real work (queries, API calls, file reads) must never live at module level:
# it would run every 30s per file AND once more per task attempt.
PARSED_AT = datetime.now(timezone.utc)


def report_run_context(**context) -> None:
    """Log the interval this run owns, and how stale the parse-time constant already is."""
    parse_age = (datetime.now(timezone.utc) - PARSED_AT).total_seconds() / SECONDS_PER_MINUTE

    log.info("run_id             = %s", context["run_id"])
    log.info("logical_date       = %s", context["logical_date"])
    log.info("data_interval      = [%s, %s)",
             context["data_interval_start"], context["data_interval_end"])
    log.info("ds (template)      = %s", context["ds"])
    log.info("try_number         = %s", context["task_instance"].try_number)
    log.info("file parsed at     = %s  (%.1f min before this task ran)", PARSED_AT, parse_age)


with DAG(
    dag_id="sprint05_hello",
    description="First hand-written DAG -- parse vs run, data interval, idempotency",
    start_date=datetime(2026, 8, 1),
    schedule="@daily",
    catchup=False,
    max_active_runs=1,
    tags=["lab", "sprint05", "learning"],
) as dag:
    hello = BashOperator(
        task_id="hello",
        # {{ ds }} is derived from logical_date, which equals data_interval_start ONLY for
        # scheduled runs. A manual trigger sets logical_date = "now", so ds silently drifts
        # off the interval. Window your queries on data_interval_start/end, never on ds.
        bash_command=(
            'echo "hello from {{ run_id }}"; '
            'echo "  ds                 = {{ ds }}"; '
            'echo "  data_interval_start= {{ data_interval_start }}"'
        ),
    )
    context_report = PythonOperator(
        task_id="report_run_context",
        python_callable=report_run_context,
    )

    goodbye = BashOperator(
        task_id="goodbye",
        bash_command='echo "run {{ run_id }} finished"',
    )

    hello >> context_report >> goodbye
