# Month 1 — takeaways (ClickHouse foundations + manual EL)

Consolidation of Sprints 1–4. This is also the review sheet for the Sprint 5 "Month-1 review":
be able to reproduce the **bold** rules from memory, no docs.

Everything below is grounded in this lab: `clickhouse-platform` (HTTP `:8123`), the `sandbox`
and `shop_raw` databases, and the `raw.events` / shop-db source data.

---

## 1. The MergeTree machine (Sprint 1)

Every MergeTree-family table is a pile of **immutable, sorted parts**. `INSERT` writes a new part;
a background pool **k-way-merges** small parts into bigger ones, on ClickHouse's own schedule.

- `ORDER BY` does two jobs: (1) physical sort order, (2) the **sparse** primary index (1 mark per
  `index_granularity`=8192 rows). It is **not** a uniqueness constraint.
- **Batch your inserts.** One insert = one part; thousands of tiny inserts → `TOO_MANY_PARTS`.
- Part name `{partition}_{minBlk}_{maxBlk}_{level}`, e.g. `all_1_2_1` = partition `all`, blocks 1–2,
  merged once.

What differs across the family is the **fate of rows sharing the ORDER BY key at merge**:

| Engine | Same-key rows | Read deduped truth with | Use for |
|---|---|---|---|
| `MergeTree` | all kept | n/a | raw facts, append-only events |
| `ReplacingMergeTree(ver)` | collapse to 1 (max `ver`) | `SELECT … FINAL` | latest state / dedup |
| `AggregatingMergeTree` | collapse to 1 aggregated row | `…Merge()` + `GROUP BY` | pre-aggregated rollups |

`-State` (`sumState`, `uniqState`) writes a partial-aggregate blob on insert; `-Merge` finalizes it
at read. Needed because non-additive aggregates (`uniq`, quantiles) can't be summed from a number —
the state carries the structure (a HyperLogLog sketch for `uniq`) to merge exactly.

> **One rule:** never rely on the background merge for correctness — it's eventual and may never fire
> for a given pair of parts. Force the collapse at read time: `FINAL` (Replacing) or `…Merge()`
> + `GROUP BY` (Aggregating). See [[sprint01-mergetree-engines]].

## 2. Partitioning & how reads actually work (Sprint 2)

`PARTITION BY` and `ORDER BY` are **orthogonal**: partitioning physically splits the table into
per-value directories (enables skipping whole partitions); ORDER BY sorts *within* a part.

- **Partition pruning** skips entire partitions from partition/MinMax metadata *before* reading any
  granule — but only when the query filters on the partition key. Partition on month, query by
  `user_id` with no date filter → you pay the overhead for zero pruning.
- **Coarse partition keys only** (`toYYYYMM`, daily): every partition is ≥1 part, so a
  high-cardinality key explodes the part count → `TOO_MANY_PARTS`. Aim for tens–low-hundreds.
- A part belongs to **exactly one** partition — that's what makes `DROP PARTITION` / TTL cheap
  metadata ops instead of row-by-row deletes.

The index funnel in `EXPLAIN indexes=1`: **MinMax → Partition → PrimaryKey**, each reporting
parts/granules kept out of total. The PK stage is sparse — it resolves to **granules (~8192 rows),
never exact rows**, so a point lookup reads whole granules around the matches.

- `binary search` = filter hit the **leading** ORDER BY column → PK jumps straight there.
- `generic exclusion search` = filter on a **non-prefix** key column → PK can only exclude some
  granules → much slower. **Rule: put the highest-selectivity / most-filtered column first.**

Columnar payoff: a `sum(amount)` reads only the `amount` column file (ClickHouse) vs the whole row
(Postgres Seq Scan). One physical sort order per table; other access patterns need a data-skipping
index or a projection. See the Sprint 2 Anki deck.

## 3. Materialized views (Sprint 3)

A ClickHouse MV is an **insert trigger**, not a refreshed cache: its SELECT runs on **each inserted
block** of the source and appends the result to a **separate target table**. It sees only that
block's rows — a `GROUP BY` therefore produces **partial per-block aggregates**, so the target is an
`AggregatingMergeTree` of `-State` columns, finalized at read with `-Merge`. Cost scales with the
**new block**, never the whole table.

- MVs are **forward-only**: a new MV does not see pre-existing rows.
- `POPULATE` is **unsafe on a live table** — rows inserted during the snapshot→trigger gap are seen
  by neither and silently lost.
- **Safe backfill:** create the MV with `WHERE marker >= T` (a future, insert-assigned monotonic
  boundary like `now64()` — never event-time), then after the clock passes `T`,
  `INSERT INTO target SELECT …State… WHERE marker < T`. Shared boundary → every row exactly once
  (overlap double-counts into aggregate states, which can't be de-duplicated after the fact).
- Prefer `CREATE MATERIALIZED VIEW … TO <table>`: decouples transform from storage you own.
- `INSERT … SELECT` maps **by position, not name** — always list target columns explicitly.

## 4. Manual EL: shop-db → ClickHouse (Sprint 4)

The pre-Airflow pipeline, [[../../etl/pg_to_clickhouse.py]]. Month 2 rebuilds this exact flow as a DAG.

- **Extract** with a **server-side (named) cursor** + `fetchmany(2000)` — the result set stays on the
  Postgres server and streams in batches; `fetchall()` is the move that OOMs on a big table.
- **Transform** is minimal and lives in the DDL: PG → CH types (`text`→`String`, low-distinct →
  `LowCardinality(String)`, `numeric`→`Decimal(10,2)`, timestamps → `DateTime64(3,'UTC')`).
- **Load** into `ReplacingMergeTree(_loaded_at) ORDER BY id`. A full re-extract is **idempotent**:
  each run stamps a fresh `_loaded_at`; on the next merge the newest row per `id` wins. No
  delete-then-insert, no accumulating dupes.
- **Verify** = Postgres `count(*)` vs ClickHouse `count() FINAL`. The `FINAL` is load-bearing:
  right after a re-run there are two physical copies per id until a merge fires, so a plain `count()`
  would spuriously exceed the source. (On this tiny table the merge fires within seconds; on a big
  table you'd see raw `count()` > `count() FINAL` for a while.)

> **One rule:** idempotency here is "re-running lands the same *deduplicated* truth," not "re-running
> inserts nothing." The dedup is deferred to merge + read-time `FINAL`, exactly like Sprint 1.

## 5. SQL dialect: windows & CTEs (Sprint 4, ongoing)

Full drill and verified solutions in [[../sql-drill-sprint04]]. The dialect essentials:

- No `LAG`/`LEAD` → `lagInFrame(x, off, default)` / `leadInFrame(...)`. They obey the **window frame**;
  the default frame (with `ORDER BY`) is `RANGE … UNBOUNDED PRECEDING → CURRENT ROW`, so `lagInFrame`
  works as-is but `leadInFrame` sees nothing unless you widen the frame.
- `QUALIFY` filters on a window result with no wrapping subquery (windows' answer to `HAVING`).
- `LIMIT n` cuts **rows** (a global cut); `QUALIFY dense_rank() <= n` cuts **ranks** (per-partition,
  can return >n rows on ties). Greatest-N-per-group = `PARTITION BY g` + `row_number()`/`rank` +
  `QUALIFY`, never `LIMIT`.
- Aggregate-inside-window is legal (`dense_rank() OVER (ORDER BY sum(amount))`) — windows run
  **after** `GROUP BY`. `argMin(a,b)`/`argMax(a,b)` replace `first_value`/`last_value`.
- Ranking trio: `row_number` (always unique), `rank` (ties share then skip: 1,1,3),
  `dense_rank` (ties share, no gap: 1,1,2).
- Default division: CH returns `inf`/`nan` for `1/0`, `0/0` with no error — guard it yourself.

## What I can now do

Design a MergeTree schema (engine + `ORDER BY` + partition key) for an access pattern; read an
`EXPLAIN indexes=1` funnel and say why a query scans or skips; build an incremental aggregation with
an MV + `AggregatingMergeTree` and backfill it safely; move data PG→CH idempotently by hand and
verify it; and write greatest-N / running-total / moving-average / period-over-period SQL in the
ClickHouse dialect.

## Related
- Month 2 (Airflow) turns §4's script into a scheduled, idempotent DAG.
- SCD2 on ReplacingMergeTree/snapshots — Sprint 11, [[../drills/01-batch-and-modeling]].
