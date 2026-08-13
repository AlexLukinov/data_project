-- Load a shop-shaped dataset into Greengage with explicit distribution keys, generated in-place
-- (no external dependency). customers and orders are distributed by DIFFERENT keys so that a join
-- on customer_id forces a redistribute/broadcast Motion — the thing to demonstrate. Idempotent.
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (id int, name text, city text)
  DISTRIBUTED BY (id);
INSERT INTO customers
  SELECT g, 'customer_' || g, (ARRAY['Moscow','Kazan','Saint Petersburg'])[1 + (g % 3)]
  FROM generate_series(1, 1000) g;

CREATE TABLE orders (id int, customer_id int, amount numeric)
  DISTRIBUTED BY (id);                    -- NOT by customer_id, so joins on it must move data
INSERT INTO orders
  SELECT g, 1 + (g % 1000), round((random() * 100)::numeric, 2)
  FROM generate_series(1, 10000) g;

ANALYZE customers;
ANALYZE orders;
