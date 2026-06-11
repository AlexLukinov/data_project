select
    id as order_item_id,
    order_id,
    product,
    quantity,
    unit_price,
    quantity * unit_price as line_total
from {{ source('raw', 'order_items') }}
