select
    id as customer_id,
    name,
    email,
    city,
    created_at
from {{ source('raw', 'customers') }}
