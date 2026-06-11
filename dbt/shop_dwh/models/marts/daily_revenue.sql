{{ config(materialized='table', engine='MergeTree()', order_by='order_date') }}

select
    order_date,
    count(*) as orders,
    round(sum(amount), 2) as revenue
from {{ ref('fct_orders') }}
where status != 'cancelled'
group by order_date
