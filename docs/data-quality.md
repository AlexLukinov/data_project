# Data quality

## What we run today (dbt tests)

The dbt project (`dbt/shop_dwh`) ships schema tests that run automatically as part of
`dbt build` in the batch DAG (`shop_batch_pipeline` → `dbt_build`) and standalone via
`scripts/smoke/phase11_dq.sh`:

| Layer | Model | Tests |
|---|---|---|
| staging | `stg_customers` | `customer_id` not_null, unique |
| staging | `stg_orders` | `order_id` not_null+unique; `customer_id` not_null + **relationships → stg_customers**; `amount` not_null; `status` accepted_values |
| staging | `stg_order_items` | `order_item_id` not_null+unique; `order_id` not_null + **relationships → stg_orders** |
| marts | `fct_orders` | `order_id` not_null+unique; `customer_id` not_null + **relationships → stg_customers**; `amount` not_null |
| marts | `daily_revenue` | `order_date` not_null+unique; `revenue` not_null |

20 tests, all green. These cover the failure classes that matter for this warehouse:
missing keys, duplicate keys, broken referential integrity, and out-of-domain status values.

## Should we add Great Expectations as a pre-load raw validation step? — No (for now)

**Recommendation: do not add standalone Great Expectations to the Airflow DAG yet.**

Reasoning, in the spirit of the lab (boring tech, YAGNI, minimal footprint):

- **Overlap.** dbt tests already assert not_null / unique / relationships / accepted_values.
  GE would re-check the same failure classes, just earlier and with a heavier toolchain.
- **Footprint & dependency risk.** GE brings its own config, expectation store and data-docs,
  and its dependency set conflicts with the Airflow 2.11 constraints — the exact reason dbt is
  already isolated in `/opt/dbt-venv`. Adding GE means a second isolated venv and more moving parts.
- **Where the value is.** The batch DAG does a full-snapshot, idempotent load, so the highest-value
  checks are post-load on the modelled warehouse (dbt) rather than pre-load on `raw`.

**If pre-load validation on raw is ever wanted**, prefer the lighter option first:
- `dbt-expectations` (a dbt package with GE-style expectations) — stays inside the existing dbt
  toolchain, no new runtime; or
- a handful of inline assertions in the `extract_to_minio` / `load_raw_to_clickhouse` tasks
  (row-count > 0, PK not null) — proportionate to a laptop lab.

**Add full Great Expectations only if** the lab later needs rich HTML data-docs for stakeholders,
expectation suites shared across non-dbt pipelines, or profiling-based expectations — none of which
this stand needs today.
