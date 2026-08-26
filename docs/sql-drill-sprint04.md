# Sprint 4 — SQL drill (window functions & CTEs, ClickHouse dialect)

Interview-style. Write the SQL yourself; send each answer back for live grading against `shop_raw`.
**Solved:** Q1–Q5. **Remaining:** Q6–Q14 below.

## Run against the lab

```bash
# port-forwards must be up (scripts/resume.sh restores them)
q(){ curl -s "http://127.0.0.1:8123/?user=admin&password=admin" --data-binary "$1"; }
q "SELECT ... FORMAT PrettyCompact"
```

## Schema (`shop_raw`, all ReplacingMergeTree — read the deduped truth with FINAL)

```
customers(id, name, email, city, created_at)
orders(id, customer_id, status, order_ts, amount, created_at)      -- 10k rows, 2026-03-13 .. 2026-06-11
order_items(id, order_id, product, quantity, unit_price)           -- 30k rows
```

---

## Solved (Q1–Q5) — solutions & notes

Each solution is verified against the live `shop_raw` data. The **note** is the interview trap the
problem is built to catch.

### Q1 — Top 10 customers by total spent (greatest-N)

```sql
SELECT
    customer_id,
    sum(amount)                                 AS total_spent,
    dense_rank() OVER (ORDER BY sum(amount) DESC) AS rnk
FROM shop_raw.orders
GROUP BY customer_id
ORDER BY total_spent DESC
LIMIT 10;
```

**Note.** You must **collapse to one row per customer first** (`GROUP BY customer_id`), then rank the
totals. The classic bug is `sum(amount) OVER (PARTITION BY customer_id)` — a *window* aggregate keeps all
10 000 order rows and ranks individual orders, so the "top" customer is whoever has the single cheapest
order. `LIMIT 10` cuts **rows**; if you want "everyone tied within the top 10 ranks" use
`QUALIFY dense_rank() OVER (ORDER BY sum(amount) DESC) <= 10` instead. Aggregate-inside-window
(`dense_rank() OVER (ORDER BY sum(amount))`) is legal in ClickHouse — windows run *after* `GROUP BY`.

### Q2 — Top customer in each city (greatest-1-per-group)

```sql
SELECT
    c.city,
    o.customer_id,
    any(c.name)      AS name,
    sum(o.amount)    AS total_spent
FROM shop_raw.orders o
JOIN shop_raw.customers c ON o.customer_id = c.id
GROUP BY c.city, o.customer_id
QUALIFY row_number() OVER (PARTITION BY c.city ORDER BY sum(o.amount) DESC) = 1
ORDER BY total_spent DESC;
```

**Note.** `ORDER BY total_spent DESC LIMIT 5` is a **global** cut — it returns the 5 biggest customers
overall, so one busy city (Saint Petersburg) appears twice and quieter cities (Moscow) vanish. "Per group"
lives only inside `PARTITION BY city`; `row_number() … = 1` picks each city's champion. `city` is on
`customers`, so you must join; `GROUP BY city, customer_id` makes `sum` per-customer-within-city, and
`any(c.name)` grabs the (single) name for the group.

### Q3 — Running total of daily revenue

```sql
SELECT
    toDate(order_ts)                              AS day,
    sum(amount)                                   AS daily_revenue,
    sum(sum(amount)) OVER (ORDER BY toDate(order_ts)) AS running_total
FROM shop_raw.orders
GROUP BY day
ORDER BY day;
```

**Note.** The nested `sum(sum(amount))` is "window-sum of the per-day sum" — ClickHouse also lets you alias
it (`sum(daily_revenue) OVER (ORDER BY day)`), which Postgres rejects. It's a *running* total (not the grand
total) purely because of the **default frame** with `ORDER BY`: `RANGE BETWEEN UNBOUNDED PRECEDING AND
CURRENT ROW`. Verified: the last `running_total` equals the grand total **2 524 647.65**.

### Q4 — 7-day moving average of the daily order count

```sql
SELECT
    toDate(order_ts) AS day,
    count(id)        AS orders_that_day,
    avg(count(id)) OVER (ORDER BY toDate(order_ts)
                         ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS ma7
FROM shop_raw.orders
GROUP BY day
ORDER BY day;
```

**Note.** Average the **daily count**, not `amount` (`avg(count(id))`, an aggregate inside the window).
`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` = 7 **rows**, and rows ≠ calendar days: a day with zero orders
produces no row, so the frame would silently average 7 *present* days spanning >7 calendar days. Here every
day has orders, so it's a true 7-day average. No `PARTITION BY` → the whole ~91-day series is one belt; the
frame slides across month boundaries and warms up only once at the first day.

### Q5 — Day-over-day revenue change

```sql
SELECT
    toDate(order_ts) AS day,
    sum(amount)      AS daily_revenue,
    lagInFrame(daily_revenue, 1, daily_revenue) OVER (ORDER BY day) AS prev_daily_revenue,
    daily_revenue - prev_daily_revenue AS delta
FROM shop_raw.orders
GROUP BY day
ORDER BY day;
```

**Note.** ClickHouse has no `LAG`; use `lagInFrame`. It looks **backward**, so the default frame (which ends
at `CURRENT ROW`) already contains the previous row — no widening needed (unlike `leadInFrame`). The 3rd arg
is the **default for the first row**: here `daily_revenue` makes `delta = 0` on day 1 (at the cost of
`prev` reading today's own value). Alternatives: `lagInFrame(daily_revenue, 1)` defaults to **0** (→ day-1
`delta` = full revenue), or a `Nullable` default → `prev` and `delta` are `NULL` on day 1.

---

## Remaining problems

**Q6 — Customer order cadence.**
For each customer with **≥ 2 orders**, average days between their consecutive orders. Return the 10
customers with the *smallest* average gap.
Output: `customer_id, orders_count, avg_gap_days`.
*Pattern: `lagInFrame(order_ts)` **partitioned per customer**, `dateDiff('day', prev, cur)`, then aggregate the gaps.*

**Q7 — Month-over-month growth %.**
Per month: revenue, previous month's revenue, growth% = `(this-prev)/prev*100` (1 decimal). First month `NULL`.
Output: `month, monthly_revenue, prev_month_revenue, growth_pct`.
*Pattern: `toStartOfMonth` bucket, then lag one row.*

**Q8 — First & biggest order per customer, one pass.**
Per customer: date of their **first** order, and the **amount + date of their most expensive** order.
No self-joins, no subqueries. Show the 10 whose biggest order is largest.
Output: `customer_id, first_order_day, biggest_amount, biggest_order_day`.
*Pattern: `min` / `argMin` / `argMax` in one `GROUP BY customer_id`.*

**Q9 — Each city's share of total revenue.**
Per city: revenue and its **percent of the grand total** (1 decimal), ordered by share desc.
Output: `city, city_revenue, pct_of_total`.
*Pattern: `sum(...) OVER ()` (empty window = grand total) as the denominator, alongside a `GROUP BY city`.*

**Q10 — Revenue Pareto (cumulative % by day).**
Rank days by revenue **descending**; for each, the running cumulative revenue and **cumulative % of grand
total**. The answer you're after: how many top days make up the first 50%?
Output: `day, daily_revenue, running_pct`.
*Pattern: running `sum() OVER (ORDER BY daily_revenue DESC)` divided by grand total.*

**Q11 — Signup cohorts.**
Bucket each customer by the **month of their first order** (their cohort). Per cohort month, how many
customers belong to it.
Output: `cohort_month, customers`.
*Pattern: per-customer `min(order_ts)` in a CTE/subquery, `toStartOfMonth`, then `GROUP BY`.*

**Q12 — New vs returning orders per day.**
Per calendar day: how many orders were a customer's **first-ever** order vs a **repeat**.
Output: `day, new_orders, repeat_orders`.
*Pattern: `row_number() OVER (PARTITION BY customer_id ORDER BY order_ts)` — rank 1 = new — then aggregate per day.*

**Q13 — Product leaderboard with revenue share.**
Top 5 products by revenue (`quantity * unit_price`), each with its **percent of total product revenue**.
Output: `product, product_revenue, pct_of_total`.
*Pattern: join/aggregate `order_items`, `sum() OVER ()` for the denominator, `QUALIFY`/`LIMIT` for top 5.*

**Q14 — Fast reorders.**
Per customer, count how many of their orders came **within 7 days** of their previous order. Return the 10
customers with the most such fast reorders.
Output: `customer_id, fast_reorders`.
*Pattern: `lagInFrame(order_ts)` partitioned per customer, `dateDiff('day', …) <= 7`, count — a stricter cousin of Q6.*

---

## After the queries (rest of Sprint 4)

- [ ] Short **month-1 README** — takeaways (MergeTree family, partitioning/EXPLAIN, materialized views, manual EL, window/CTE dialect).
- [ ] Reading: **DDIA ch. 6** (partitioning).
- [ ] Anki: daily review + the Sprint-4 deck (`anki/sprint-04.tsv`) into a dedicated "ClickHouse" deck.
