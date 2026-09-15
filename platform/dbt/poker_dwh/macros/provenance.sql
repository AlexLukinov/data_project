{#
  Who derived this fact row: 'dbt' here, 'hot' when the same SQL is rendered by
  scripts/hot_path_sql.py for a just-ingested batch (ADR-047).

  The column is the guard against the lost-update race between the hot path and dbt's
  `REPLACE PARTITION`. The generated rollup aggregates only rows dbt derived, and the gate in
  macros/incremental.sql treats a partition holding any 'hot' row as dirty -- so a partition reads
  clean only once everything in it was derived by dbt from a snapshot that included every hand in
  it, whichever way the two writers interleaved.

  Cast explicitly: `insert_overwrite` swaps partitions between the temp table and the target, and
  a bare string literal would give the temp table a String column against the target's
  LowCardinality(String).
#}

{% macro built_by() -%}
    'dbt'::LowCardinality(String)
{%- endmacro %}
