select
    id as order_id,
    customer_id,
    status,
    order_ts,
    toDate(order_ts) as order_date,
    amount
from {{ source('raw', 'orders') }}
