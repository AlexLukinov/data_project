# Sprint 1 — MergeTree engine family (practical differences)

Grounded in the lab: demos live in the `sandbox` database on `clickhouse-platform`.
Source data is `raw.events` (541k rows landed from the event generator).

## The shared machine

Every MergeTree-family table is a pile of immutable, sorted **parts**. `INSERT` writes a new
part; a background pool **merges** small parts into bigger ones (k-way merge of sorted runs).

- `ORDER BY` = sort order + sparse primary index (1 mark / `index_granularity`=8192 rows).
  It is **not** a uniqueness constraint.
- Batch your inserts. Each insert = a part; thousands of tiny inserts is the classic
  ClickHouse anti-pattern (too many parts → merge pressure → `TOO_MANY_PARTS`).
- Merges are **eventual** and not guaranteed to have happened when you read.

## What differs: fate of rows sharing the ORDER BY key at merge

| Engine | Same-key rows at merge | Read-time correctness | Use for |
|---|---|---|---|
| `MergeTree` | all kept | n/a | raw facts, events, append-only |
| `ReplacingMergeTree(ver)` | collapse to 1 (max `ver`) | `SELECT … FINAL` | latest state of a row / dedup |
| `AggregatingMergeTree` | collapse to 1 aggregated row | `…Merge()` + `GROUP BY` | pre-aggregated rollups |

### MergeTree
Baseline. Two inserts → two parts (`all_1_1_0`, `all_2_2_0`); `OPTIMIZE … FINAL` → one part
(`all_1_2_1`, level=1). Nothing is ever removed. Part name = `{partition}_{minBlk}_{maxBlk}_{level}`.

### ReplacingMergeTree(version)
Dedups by `ORDER BY` key, keeping the row with the **highest version** (ties without a version
column are nondeterministic — always pass one). Collapse is eventual, so read with `FINAL`
(or `argMax`/`GROUP BY`) when you need the deduped truth. Optional `is_deleted` col for soft deletes.
Models "current state" (e.g. a customer's latest tier) on top of an append-only load.

### AggregatingMergeTree
Rows with the same key **combine via aggregate functions** instead of being dropped.
Store partial states with `-State` (`countState`, `uniqState`, …), read them back with `-Merge`
(`countMerge`, `uniqMerge`). Needed because non-additive aggregates (`uniq`, quantiles) can't be
summed from plain numbers — the state (e.g. a HyperLogLog sketch for `uniq`) carries enough to
merge exactly. Usually fed by a materialized view (Sprint 3).

## The one rule to remember
Never rely on the background merge for correctness. It is eventual and may never merge two given
parts. Force the collapse at read time: `FINAL` (Replacing) or `…Merge()` + `GROUP BY` (Aggregating).

## Related
- Partitioning + `EXPLAIN` — Sprint 2
- Materialized views + `-State`/`-Merge` deep dive — Sprint 3
- SCD2 via ReplacingMergeTree/snapshots — Sprint 11, see [[docs/drills/01-batch-and-modeling.md]]
