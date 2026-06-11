{{ config(materialized='table', engine='MergeTree()', order_by='order_id') }}

-- Alias every column explicitly: ClickHouse keeps the qualifier (e.g. o.order_id) for
-- columns that exist in more than one joined relation, which breaks downstream refs/tests.
select
    o.order_id                      as order_id,
    o.customer_id                   as customer_id,
    c.city                          as city,
    o.status                        as status,
    o.order_ts                      as order_ts,
    o.order_date                    as order_date,
    o.amount                        as amount,
    coalesce(i.item_count, 0)       as item_count,
    coalesce(i.items_total, 0.0)    as items_total
from {{ ref('stg_orders') }} as o
left join {{ ref('stg_customers') }} as c
    on c.customer_id = o.customer_id
left join (
    select
        order_id,
        count(*) as item_count,
        sum(line_total) as items_total
    from {{ ref('stg_order_items') }}
    group by order_id
) as i
    on i.order_id = o.order_id
