{#
  Use the model's custom schema (staging / intermediate / marts) directly as the ClickHouse
  database, instead of dbt's default <target_schema>_<custom_schema> concatenation -- with
  the deployment's database prefix in front.

  `CLICKHOUSE_DB_PREFIX` is the same setting the Python side reads (`core.settings`): empty
  for the real analysis databases, `test_` for the integration suite and `make seed`, so a
  dbt build of synthetic hands can never land in the founder's marts.
#}
{% macro db_prefix() -%}
    {{ env_var('CLICKHOUSE_DB_PREFIX', '') }}
{%- endmacro %}

{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ db_prefix() }}{{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
