-- Enable Debezium CDC on shop-db. Idempotent; run as a superuser against the 'shop' database.
-- shop-db already runs wal_level=logical (CNPG default), so only the role + publication remain.

-- Debezium needs a replication-capable login. 'shop' owns the source tables, so it can also
-- own the publication used by pgoutput.
ALTER ROLE shop WITH REPLICATION;

-- Publication the Debezium pgoutput plugin reads from (one per-table topic downstream).
DROP PUBLICATION IF EXISTS dbz_publication;
CREATE PUBLICATION dbz_publication FOR TABLE customers, orders, order_items;
