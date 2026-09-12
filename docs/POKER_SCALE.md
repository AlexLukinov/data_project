# Poker platform — scale design: one node → a sharded cluster

> **Design document. Nothing here is built.** This is [POKER_PLAN.md](POKER_PLAN.md) step **E.4**,
> the concrete form of [ADR-025](POKER_DECISIONS.md#adr-025--freshness-and-scale-materialized-views-generated-from-the-registry-then-shard-by-tenant)'s
> one-sentence scale plan, recorded as
> [ADR-036](POKER_DECISIONS.md#adr-036--shard-by-cityhash64user_id-with-a-reserved-tenant-for-the-pool-buy-threads-before-shards).
> ADR-025 says *build it when a second node exists*; that is still true. This says **what** to
> build, **in what order**, and **how many nodes** the measurements imply.

**Every number in this document is labelled.** *Measured* means a run recorded in this repo, with
the file it lives in. *Derived* means arithmetic on measured numbers. *Extrapolated* means a model
fitted to one or two measurements and projected past them — those are the ones to distrust, and
each says what would have to be measured to replace it. Nothing multi-node has ever been run
here, so **every claim about cross-shard behaviour is reasoning about the code, not a
measurement.**

---

## 1. What "a 4 GB node" is, exactly

The cost table is only honest if the node is defined, and it is — in three files that must stay in
step ([docker-compose.yml:51-63](../platform/docker-compose.yml#L51-L63)).

| Knob | Value | Where | Why it is that |
|---|---|---|---|
| Container cap | `${CLICKHOUSE_MEM:-4G}` | [docker-compose.yml:63](../platform/docker-compose.yml#L63) | the unit of the cost table |
| Server ceiling | 3.60 GiB | **never set** — ClickHouse's implicit 0.9 × container | the budget a dbt pass actually trips |
| Per-query ceiling | 2.5 GB | [limits.xml:37](../platform/infra/clickhouse/limits.xml#L37) | a runaway query is rejected, not OOM-killed |
| Threads per query | **2** | [limits.xml:64](../platform/infra/clickhouse/limits.xml#L64) | "a cheap production node has 2-4 vCPU"; each pipeline holds its own join state |
| Concurrent queries | 16 | [small-node.xml:40](../platform/infra/clickhouse/small-node.xml#L40) | each slot is a potential memory claim |
| Mark cache | 512 MiB | [small-node.xml:27](../platform/infra/clickhouse/small-node.xml#L27) | the one cache worth keeping |
| Uncompressed cache | **off** | [small-node.xml:33](../platform/infra/clickhouse/small-node.xml#L33) | an analytics scan evicts it constantly |
| Idle RSS after that sizing | 3.60 → **1.12 GiB** *(measured)* | [ADR-019](POKER_DECISIONS.md#adr-019--the-stat-chain-is-incremental-by-daily-partition-anchored-and-backfilled-in-batches) | leaves ~2.5 GiB for work, which is why the query ceiling is 2.5 GB |
| Spill thresholds | 900 MB group-by / sort | [limits.xml:41-42](../platform/infra/clickhouse/limits.xml#L41-L42) | switch to the external algorithm while there is still room |
| Join | `grace_hash,partial_merge,hash`, right side ≤ 400 MB | [limits.xml:49-50](../platform/infra/clickhouse/limits.xml#L49-L50) | ClickHouse builds the **right** side in memory |
| CPU limit | **none** | `deploy.resources.limits` has only `memory` | see the caveat below |
| Per-**tenant** query ceiling | 1.5 GB / 60 s / 400M rows read | [stats/budget.py](../platform/stats/budget.py) | a tenant is refused by its own settings profile before it can threaten the server's 2.5 GB (E.3, [ADR-043](POKER_DECISIONS.md#adr-043)) |
| Per-tenant hourly quota | 3,600 queries / 10G rows / 1,800 s | [stats/budget.py](../platform/stats/budget.py) | "stops one heavy user degrading everyone" (F-208), enforced by ClickHouse's own quota |

**Two caveats to carry into every figure below.**

1. **The node is memory-realistic and CPU-optimistic.** The container caps RAM but not cores; what
   models a small node is `max_threads 2`, not a cgroup. So "1.6 s at 2 threads" is a fair read of
   a 2-vCPU node's *parallelism*, but the per-core speed is an M-series laptop's. A slower
   production core makes every latency here worse by a factor nobody has measured.
2. **Three files disagree about which node they were sized for.**
   [limits.xml:33](../platform/infra/clickhouse/limits.xml#L33) calls 2.5 GB "~69% of the 8G
   container" while [limits.xml:10](../platform/infra/clickhouse/limits.xml#L10) says the cap is
   4G, and [profiles.yml:22-23](../platform/dbt/poker_dwh/profiles.yml#L22-L23) says the
   server-wide profile is 5.5 GB when it is 2.5 GB. The two are the same staleness: 69% is what
   **5.5 GB of 8 GB** gives, so that comment dates from when the ceiling itself was 5,500,000,000
   in an 8 GB container. Against today's values it is 2.5 GB of a 4 GiB cap = **58%**. The
   **values** are current, the **comments** are not, and a cost table built from those comments
   would size every node at twice the real figure. *(Doc-drift item, recorded here in E.4 because
   that session was documentation-only. **`limits.xml:33` was corrected in E.3** — the step that
   owns `infra/clickhouse/` — which also added the per-tenant budget to the list of things that
   must stay in step, making it four files rather than three; see
   [ADR-043](POKER_DECISIONS.md#adr-043). `profiles.yml:22-23` still repeats the stale sentence:
   it belongs to the dbt project, which E.3 was not allowed to touch.)*

---

## 2. What one node holds today — the measured baseline

Everything in §7 is this table multiplied out.

| | Rows | On disk | Per row | Source |
|---|---|---|---|---|
| hands (logical) | 9,093,796 | — | — | [STATUS](POKER_STATUS.md) |
| `core.*` (4 tables) | 100,346,158 actions among them | ~5 GB | — | STATUS |
| `marts.decisions` | 73,679,949 | **3.84 GiB** | 55.9 B | STATUS |
| `marts.player_hands` | 54,562,770 | **2.18 GiB** | 43 B | STATUS |
| `marts.stats_daily` | — | 278 MiB | — | STATUS |
| partitions | 160/160 daily on every model | | | STATUS |

**Derived per-hand constants** (the whole cost model is these six numbers):

| Per hand | Value | How |
|---|---|---|
| decisions rows | **8.10** | 73,679,949 / 9,093,796 |
| player-hand rows | **6.00** | 54,562,770 / 9,093,796 |
| action rows | **11.03** | 100,346,158 / 9,093,796 |
| marts bytes | **742 B** | 453 + 257 + 32 |
| `core.*` bytes | **550 B** | ~5 GB / 9,093,796 |
| **ClickHouse bytes, all layers** | **≈ 1.29 KB** | sum |

**Measured build and serve costs on this one node:**

| What | Cost | Source |
|---|---|---|
| Bootstrap `decisions` + `player_hands` | 35 passes / **641 s**, peak 1.21 GiB | PLAN §C.2 |
| Bootstrap `stats_daily` | 35 passes / **186 s**, peak 1.66 GiB | PLAN §C.3 |
| → whole chain from empty | **827 s** for 9.09M hands = **91 s per 1M hands** *(derived)* | |
| Worst single daily partition | 878,124 player-rows (2024-12-31), 505 MiB | PLAN §C.6 |
| Monthly partition, 20.5M rows | 3.06–3.17 GiB — **fails on 4 GB** ¹ | [ADR-019](POKER_DECISIONS.md#adr-019--the-stat-chain-is-incremental-by-daily-partition-anchored-and-backfilled-in-batches) |
| Bulk import | **40,100 hands/s** across 8 processes (9.1M in 226–260 s) | STATUS |
| Re-parse from object storage | **~3,400 hands/s**, single process (9.08M in ~45 min) | PLAN §5b |
| Cached report from `stats_daily` | 0.1–0.2 s | PLAN phase-C exit |
| Hero arbitrary situation | **0.05 s** | PLAN phase-C exit |
| **Pool arbitrary situation** | **1.6 s** over 73.5M decisions at 2 threads, 0.8 s of it the scan | PLAN phase-C exit |
| Any stat query's memory | 13–29 MiB | STATUS |

¹ **The repo does not agree with itself on this pair.** ADR-019 records 2.27 GiB for the 5.9M-row
month and 3.06 GiB for the 20.5M-row one; the identical comment block in
[docker-compose.yml:45-47](../platform/docker-compose.yml#L45-L47),
[limits.xml:16-18](../platform/infra/clickhouse/limits.xml#L16-L18) and
[profiles.yml:24-25](../platform/dbt/poker_dwh/profiles.yml#L24-L25) says 2.10 GiB and 3.17 GiB.
Neither says which run produced it. The conclusion is the same either way — monthly fails on 4 GB,
daily fits — so the design below does not turn on it, but no figure in this document is quoted
tighter than that spread.

That last row is the one that sets the shard count, and it is already a **missed goal**: the plan's
own target is "answers on the full 9M-hand pool in under a second on a 4 GB node"
([POKER_PLAN.md §1](POKER_PLAN.md)), and the measurement is 1.6 s.

---

## 3. The shard key

### 3.1 `cityHash64(user_id)` is already paid for

`user_id` leads the `ORDER BY` of **every tenant-scoped table**, by explicit rule
([0001_core.sql:5-8](../platform/ch/migrations/0001_core.sql#L5-L8)) and in every mart
(`decisions` is `(user_id, dataset, player_key_norm, street, played_date, hand_uid, action_index)`).
The one exception is deliberate and matters in §4.1: `marts.baseline_strategies` has no `user_id`
column at all, because it is a shared lookup rather than tenant data.

And every read binds the tenant first, always:

```python
where = ["s.user_id = {tenant_id:UInt32}", "s.dataset = {dataset:String}"]
```
— [stats/query.py:102](../platform/stats/query.py#L102). `tenant_id` is a required function
parameter threaded from the token through `run_report` into the query builder; it is never a field
of `ReportRequest`, so it can never come from the caller's payload.

Three consequences, and they are the whole argument for this key:

- **No table rebuild.** ADR-009 warns that retrofitting `user_id` into the front of a sort key
  means rewriting every table. It is already there, so sharding is *additive*: each shard keeps
  byte-identical DDL, and the query that runs on a shard is byte-identical to the query that runs
  today.
- **Every report prunes to one shard.** With `optimize_skip_unused_shards`, `cityHash64(<constant>)`
  is evaluable at plan time, so a hero report is a single-shard read with no fan-out and no
  distributed merge.
- **Dedup survives.** `hand_uid` is a pure function of `(site, site_hand_id)`
  ([core/ids.py](../platform/core/ids.py)), `played_at_utc` is a property of the hand, and every
  core table is `ReplacingMergeTree(parsed_at)` keyed `(user_id, hand_uid, …)`. A hash of `user_id`
  sends every copy of a hand — including a re-parse two years later — to the **same shard, same
  partition, same sorted range**, where `ReplacingMergeTree` can still collapse it. The §5b
  re-parse is the proof that this path is exercised for real.

**What the shard key must therefore never be:** `hand_uid`, round-robin, file size, or worker
index. Any function that is not purely of `user_id` converts the platform from exactly-once-effect
to duplicate-on-retry, silently.

### 3.2 The correction: the population dataset is not a user

**ADR-025 says "shard by `cityHash64(user_id)`, keep the population dataset on its own shard".
As the code stands those two clauses contradict each other**, and this is the single finding that
most changes the design.

The population corpus carries the **importing account's own tenant id**:
[`import_archive.py`](../platform/scripts/import_archive.py) resolves one user from `--email` and
stamps that `tenant_id` on every row of a `--dataset population` run;
[`core/schema/hands.py`](../platform/core/schema/hands.py) writes `user_id = c.tenant_id`; hero and
pool are separated by the `dataset` **column** only
([ingestion/loader.py](../platform/ingestion/loader.py)). So today the founder's 19,802 hero hands
and 9,073,994 pool hands hash to **the same shard** — the pool is 99.8% of the corpus sitting on
one tenant id.

**Decision: reserve a tenant id for the pool corpus** (`POOL_TENANT_ID`, a constant beside
`DATASET_POPULATION`), so the shard expression stays exactly `cityHash64(user_id) % N` and nothing
else in the system learns about shards.

*Rejected alternative:* a composite expression such as
`if(dataset = 'population', 0, cityHash64(user_id) % (N-1) + 1)`. It is two lines at `insert_hands`
because `dataset` is already in scope there, but it makes the shard expression and the read
predicate disagree about what identifies a row, and every future reader of `stats/query.py` would
have to know it. Reserving an id keeps one rule: **a shard is a function of `user_id`, full stop.**

**This is a migration, not a config change.** `user_id` leads the sort key, so it cannot be
rewritten by `ALTER … UPDATE`. Re-tenanting the pool means replaying it from object storage — which
the platform can already do, and has: raw text is content-addressed and kept forever, and
`scripts/reparse.py` re-ingests 9.08M hands in ~45 minutes. It re-uses **the row's own tenant on
purpose**, so re-tenanting is an explicit new script or an explicit flag, never a quiet default.
See step 2 of §6.

### 3.3 Skew, and when to pin a tenant

[POKER_ARCHITECTURE.md](POKER_ARCHITECTURE.md) already names the defect of this key: "most users
under 500k hands, heavy users at 5–10M — `user_id` partitioning by hash would produce wildly uneven
shards … consider isolating the top ~50 users onto their own shard". ADR-009 separately rules a
separate cluster for heavy users "a real option **later** … premature now". **That distribution is
a stated expectation, not a measurement** — this repo has exactly one real tenant, so the skew of
`cityHash64(user_id)` has never been observed and cannot be, here.

The job of this document is to turn "later" into a trigger, not to claim hashing fixes skew:

> **Trigger.** Pin a tenant to its own shard when its `marts.decisions` rows exceed the per-shard
> latency cap of §7 (≈46M decisions ≈ 5.7M hands). Below that the hash is fine; above it, one
> tenant is setting the whole shard's query time for everyone else on it.

A pin has to be expressible in the sharding expression, or shard pruning stops working — a
dictionary lookup with the hash as its default (`dictGetOrDefault('tenant_shard', …,
cityHash64(user_id) % N)`) is the shape that fits. **Whether `optimize_skip_unused_shards` can
prune through `dictGet` is untested here and must be measured before anything relies on it.** If it
cannot, the boring fallback is to keep the expression pure and accept that a pinned tenant is moved
by replay (§6 step 3) rather than by a lookup.

### 3.4 One definition of the shard function, with a twin

Writes pick the shard in Python (§4.4) and reads prune on ClickHouse's expression. If the two ever
disagree, rows become invisible to the reader that should find them — a silent failure of exactly
the kind this repo has been bitten by twice.

The repo already has the pattern for this: `NodeKey` is defined once in
`analysis/pool/nodes.py` with a TypeScript twin in `poker-core/src/node.ts` and **one fixture both
suites parse** (ADR-028/031). Do the same here: one `shard_of(user_id)` in Python, the SQL
expression rendered from the same `N`, and a fixture of `(user_id → shard)` pairs that both a unit
test and a ClickHouse query check. Not a convention — a test.

---

## 4. `Distributed` marts

### 4.1 Which tables, and which emphatically not

| Table | Under sharding |
|---|---|
| `core.hands` / `hand_players` / `actions` / `pot_winners` | local per shard (`ReplacingMergeTree`, unchanged) + a `Distributed` read wrapper |
| `marts.decisions` / `player_hands` / `stats_daily` | local per shard (dbt writes these) + `Distributed` read wrapper |
| `intermediate.int_board_by_street` | local only — it is dbt's, never read by the API |
| `core.parse_failures` | shards identically (sorted `(user_id, failed_at, error_code)`); an ops backlog, so a read wrapper is enough |
| **`marts.baseline_strategies`** | **never sharded.** It is the only table with **no `user_id` column at all** ([0002_seams.sql](../platform/ch/migrations/0002_seams.sql)) — a global lookup joined by `spot_key`. Replicate it on every node (or make it a Dictionary), or every report becomes a distributed join. It also has no `PARTITION BY`, so a whole-set swap by `baseline_set_id` is the only reload mechanism its DDL allows |

### 4.2 The read-side swap is one dict

```python
PHYSICAL: dict[Table, str] = {"stats_daily": "stats_daily", "player_hands": "player_hands", "decisions": "decisions"}
```
— [stats/query.py:28-32](../platform/stats/query.py#L28-L32). Every engine read builds its table
name through it. Pointing those three at `*_dist` is a one-file change, and it is the reason §6
can keep dbt untouched: **local tables keep today's names, the `Distributed` wrappers get new
ones.**

The `core.*` reads are *not* centralised the same way — `api/hand_query.py` holds its own `CORE`
constant and issues `FINAL` joins at eight sites. That is the second place to change, and it is
worth naming because of §4.3.

### 4.3 What is correct across shards, and what only looks correct

- **`FINAL` over a `Distributed` table deduplicates within each shard only.** Every staging model
  reads `core.* FINAL` and `core.v_format_drift` exists *because* a missing `FINAL` made the drift
  monitor double-count. This stays correct **only because every copy of a hand lives on one
  shard** (§3.1). That is a load-bearing invariant and belongs in the DDL comment: a future
  "shard the pool by `hand_uid`" change would silently un-deduplicate every `FINAL` read in the
  platform.
- **`uniqCombined64(20)` merges correctly across shards; `uniqExact` would have killed the
  initiator.** `uniqExact(hand_uid)` for the `hands` column cost **3.3 s and 850 MiB inside one
  query** before it was replaced (−0.12% error on the 9M-hand pool, 16 MiB). Under fan-out the
  initiator holds every shard's aggregate state, so unbounded-state aggregates multiply by the
  shard count on a node with ~2.5 GiB of headroom. **Rule: no unbounded-state distinct-count in
  the registry, ever.** What was a speed fix in phase C is a correctness constraint on a cluster.
- **The cohort subquery is safe only because the pool is single-shard.**
  `ReportRequest.cohort` compiles to `player IN (SELECT player_key FROM stats_daily GROUP BY … HAVING …)`
  ([stats/query.py](../platform/stats/query.py), `stats/cohort.py`). Across shards that inner query
  must be `GLOBAL IN`, or each shard evaluates it over its own rows and quietly answers a different
  question. With the pool corpus on one shard (§3.2) the whole thing — outer query and subquery —
  is local, and plain `IN` stays correct. **The pool-shard isolation pays twice: once for latency,
  once for this.**

### 4.4 Writes go to the local table, never through `Distributed`

Two invariants in the code break under a distributed insert:

1. **One INSERT = one part.** Batches are 5,000 rows
   ([core/settings.py](../platform/core/settings.py)) precisely because "thousands of tiny inserts
   hit `TOO_MANY_PARTS`". A `Distributed` insert fans one batch into N per-shard parts, multiplying
   part creation by the shard count for the same data.
2. **The Kafka offset is committed after the insert returns**
   ([ingestion/worker.py](../platform/ingestion/worker.py), `asynchronous=False`). With
   `Distributed`'s default async forwarding, "returned" means "queued on the coordinator", and the
   at-least-once contract the worker documents becomes false.

The change is small and lands in one place: every write funnels through
`insert_hands(client, hands, tenant_id, dataset)`
([ingestion/loader.py](../platform/ingestion/loader.py)), where `tenant_id` is already an argument,
and **a batch never straddles tenants** — the worker takes it from `message.tenant_id`, the importer
from a per-process context, the re-parse from the row's own `user_id`. So `shard_of(tenant_id)` is
computable there with no new plumbing. What must change is
[ingestion/clickhouse.py](../platform/ingestion/clickhouse.py): the client is an
`@lru_cache(maxsize=1)` singleton over one host, and becomes a cache keyed by shard.

Kafka needs nothing: messages are already keyed by `tenant_id`
([ingestion/bus.py](../platform/ingestion/bus.py)), which is why that module's docstring already
calls the tenant "the natural sharding unit". Note the partitioners do **not** agree — Kafka uses
murmur2 over the key, the shard map uses cityHash64 — so either any worker writes to any shard
(smallest change; the sink is already injectable) or the produce side sets the partition
explicitly. **The topic partition count is not configured anywhere** (topics are auto-created), so
that number has to be chosen before this choice means anything.

### 4.5 Replication is a different axis, and it is already decided

Shards are ours to design. Replicas are not: [ADR-013](POKER_DECISIONS.md#adr-013--rent-anything-with-a-replication-protocol) says rent
anything with a replication protocol and names ClickHouse as "the component where managed buys the
most", and the gap analysis is blunt — production needs "at least 2 replicas + Keeper, or managed
ClickHouse". Nothing in this repo has ever run `ReplicatedMergeTree` or Keeper.

If replication is ever self-hosted, one question has to be answered first and is **not** answered
here: **`insert_overwrite` is `ALTER TABLE … REPLACE PARTITION`** (macros/incremental.sql), and how
that behaves under replication — replicated as one entry, or racing a merge — is untested. That is
the single riskiest unknown in this whole design, because the entire incremental chain rests on it.

---

## 5. dbt per shard

Mechanically this is close to free, and for a reason the profile states in its first two lines:
every connection value is an `env_var`, "so the same project runs against docker-compose locally
and against managed ClickHouse later with no file edits". **A shard is another target, not another
project.**

**It is also mandatory, not a preference.** The chain is built with
`incremental_strategy='insert_overwrite'`, i.e. `ALTER TABLE … REPLACE PARTITION` against a temp
table — an operation that exists only on a **local** MergeTree. dbt cannot be pointed at a
`Distributed` table at all.

Four things must become per-shard, and three of them are in `scripts/backfill.py`:

1. **The row budget is per-node physics.** `DEFAULT_ROW_BUDGET = 2_000_000` is calibrated by
   measurement — 2.28M rows succeeded, 2.41M and 2.49M failed — and what trips is **the server's
   3.6 GiB total, not the 2.5 GB query ceiling**. A single dirty-partition gate run over a
   `Distributed` table returns cluster-wide row counts and would size every pass N× too large. So:
   N independent loops, N budgets, N no-progress guards.
2. **The gate is per-shard by construction and must stay local.** `anchors.dirty_sql` compares, per
   `toYYYYMMDD` partition, `max(parsed_at)` in `core.hands` against `max(src_parsed_at)` in
   `marts.<anchor>`, and sizes the pass from `core.hand_players`. All three are per-shard
   quantities; a shard that received no hands for a day correctly has no dirty partition there.
   The anchor must stay the **last local model** — anchoring anywhere else already left
   `stats_daily` silently empty once (ADR-019).
3. **`--rebuild-from` must be applied on every shard.** The 2026-09-11 `invested_bb` incident is
   this bug one level down: an `ALTER … ADD COLUMN` dirties no partition, so a partition nothing
   else touched keeps the new column at the type's zero **forever**, and the re-parse masked it
   almost perfectly — both hero months came out zero. At N shards, running the backfill on N−1 of
   them leaves one shard's new column at zero, **queryable and wrong**, and the marts look healthy.
4. **`_clickhouse()` shells out to `docker compose exec -T clickhouse`** — a hard-coded local
   container with no host, port or shard. It becomes a client per shard. (`_dbt()` already passes
   `CLICKHOUSE_PORT` through the environment, so the dbt half needs only a loop over env vars.)

**Cross-shard assertions are the unsolved half.** Row-local tests (`assert_invested_bb_is_the_seats_own_chips`)
are per-shard truths and stay correct. Cluster-wide ones — the generated action ≤ opportunity law
test, row-count parity against `core.* FINAL`, `scripts/fingerprint.py` — are not, and need either
a `Distributed` view to run over or a redefinition as "per-shard assertion plus a summation".
Nothing in the repo does this today.

---

## 6. The migration path from one node

Written in the shape the §5b rebuild was held to: **what stays queryable, what the rollback is,
what the verification is.** The single-node path must survive every step — `docker-compose.yml`
staying able to run the whole product on one machine is
[the portability test](POKER_ARCHITECTURE.md) (rule 4), and `Distributed` over one shard is a no-op.

**Step 0 — prerequisites (no data moves).**
`shard_of()` with its SQL twin and fixture (§3.4). Plan step **E.3** done, because a per-tenant
settings profile and quota is a *per-node config artefact*: it must exist identically on every
shard, so quota rollout is part of the migration, not a sequel to it. A `<remote_servers>` cluster
definition and an `ON CLUSTER` rewrite hook in `ch/migrate.py` symmetric with the existing
`prefixed()` one — and note that `_meta.schema_migrations` is created and written on **one** node,
so on a cluster it must be replicated or every node disagrees about what has been applied.
*Rollback:* delete the config. *Verification:* `make check`.

**Step 1 — one shard, one node (a no-op cluster).**
Add `marts.{decisions,player_hands,stats_daily}_dist` as `Distributed` tables over the existing
local ones, cluster of one. Flip `PHYSICAL` in `stats/query.py` to the `_dist` names. dbt is
untouched: it still builds `marts.decisions` locally.
*Stays queryable:* everything; the local tables are never moved.
*Rollback:* drop three tables and revert one dict — `Distributed` tables are metadata, holding no
data.
*Verification:* `scripts/fingerprint.py` (756 cells, 0 mismatch is the standing result) plus the
hero fingerprint — 19,802 hands, VPIP .229573, PFR .188466, WTSD .033835, −1.37 bb/100. **Unmoved
or the step failed.**

**Step 2 — re-tenant the pool corpus (§3.2).**
Replay the population dataset from object storage under the reserved id, then drop the old rows
(`ALTER … DELETE WHERE user_id = <old> AND dataset = 'population'`), then rebuild the marts with
`scripts/backfill.py --rebuild-from`. Cost, from measurement: ~45 min of re-parse at ~3,400 hands/s
single-process plus ~14 min of mart rebuild.
*Stays queryable:* hero throughout. The pool is double-counted between the replay and the delete —
so do the delete before the mart rebuild, and treat the window as pool-unavailable rather than
pool-wrong.
*Rollback:* the old rows are still there until the delete; after it, the replay is repeatable from
L0.
*Verification:* pool hand count back to 9,073,994; hero fingerprint **identical**; pool WTSD within
the §5b figures.

**Step 3 — add shard 2…N.**
New tenants route by `shard_of` at write time. Existing tenants stay where they are until moved,
and a move is a **replay of that tenant's objects onto the new shard plus a delete from the old** —
there is no in-place move, because `user_id` leads the sort key. The object-storage layout is
already per-tenant (`site=…/user_id=…/ingested_date=…/`), so a tenant's objects are a prefix
listing.
*The exception worth knowing:* `FETCH PARTITION` / `ATTACH PARTITION FROM` moves whole daily
partitions between servers and is far cheaper — but a daily partition holds every tenant active
that day, so it only works where partitions are single-tenant, **which is exactly the pool shard**.
*Rollback:* until the delete, the tenant's rows exist on both shards and the `Distributed` read
would double-count — so the delete is the commit point, and it must be verified per tenant.
*Verification:* per-tenant row counts before and after; the fingerprint on any tenant with a
recorded one.

**Step 4 — per-shard dbt and per-shard backfill (§5).**
N loops, N budgets. The verification that matters is the one §5 point 3 describes: after any
`ALTER`, confirm the new column is non-zero **on every shard**, sampled by `cityHash64(hand_uid)` —
the assertion that missed this last time sampled by date and covered 4 months of 10.

**What is deliberately not in this path:** replication (§4.5), the materialized views of E.1, and
hot/cold S3 tiering (F-207). Each is independent of sharding and none of them is measured here.

---

## 7. Cost table — 4 GB nodes at 10M / 50M / 250M hands

**On money.** There is no price anywhere in this repo, on purpose: the production target is
explicitly undecided, [ADR-013](POKER_DECISIONS.md#adr-013--rent-anything-with-a-replication-protocol) keeps provider choice out of scope, and
the platform must move to any VPS or cloud unchanged. So this table prices in **nodes and
gigabytes**, which multiply by whatever a 4 GB / 2-vCPU instance and a gigabyte of disk cost
wherever it lands. Anything else would be inventing numbers.

### 7.1 Storage and build, straight from §2 *(derived — arithmetic on measured per-hand constants)*

| | 10M hands | 50M hands | 250M hands |
|---|---|---|---|
| `marts.decisions` rows | 81.0M | 405M | 2.03 G |
| `marts.player_hands` rows | 60.0M | 300M | 1.50 G |
| `core.actions` rows | 110M | 552M | 2.76 G |
| marts on disk | 7.4 GB | 37.1 GB | 186 GB |
| `core.*` on disk | 5.5 GB | 27.5 GB | 138 GB |
| **ClickHouse disk, all layers** | **12.9 GB** | **64.6 GB** | **323 GB** |
| Chain rebuild, one node, serial | 15 min | 76 min | 6.3 h |
| Bulk ingest at 40,100 hands/s | 4.2 min | 21 min | 1.7 h |
| Re-parse at 3,400 hands/s, 1 process | 49 min | 4.1 h | **20 h** |

Disk is not the constraint at any of these sizes: 323 GB is one ordinary volume. Note only that
ClickHouse needs free space for merges on top (a ~2× headroom rule of thumb — **assumption, not
measured here**), and that the raw text in object storage is a *separate* and **unmeasured**
number: nothing in the repo records the archive's byte total.

The re-parse row is the one that argues for itself: 20 hours single-process is the strongest
operational case for sharding, because `reparse.py` already carries `user_id` per object and would
parallelise across shards with no coordination at all.

### 7.2 What actually sets the node count

Two independent limits, both measured, and they bind on different workloads.

**(a) Scan latency — binds the pool.** *(extrapolated)* An arbitrary uncached situation took
**1.6 s over 73.5M pool decisions at 2 threads**, 0.8 s of it the scan, because the sort key leads
with tenant, dataset and player so a street predicate prunes nothing. Modelling total query time as
linear in rows scanned:

> **≈ 46M decisions ≈ 5.7M hands per shard** to answer an arbitrary situation in under a second.

*What would replace this model:* it is one measurement extended by a straight line. The scan half
is genuinely linear; the aggregation half is not necessarily. Measure the same query at 20M, 40M
and 73M decisions before trusting the slope.

**(b) Partition build memory — binds ingest density.** *(measured)* A 20.5M-row monthly partition
needed 3.06–3.17 GiB and **fails on 4 GB**; daily partitions of ≤898k rows are comfortable, and the
densest real day is 878,124 player-rows. At 6.0 player-rows per hand:

> **≈ 150k hands per day per shard**, above which the daily partition stops fitting a 4 GB node and
> the partition grain has to go finer (a fourth place to change it — ADR-019 records that grain
> lives in three places already, and "they drifted once").

### 7.3 The node count

| | 10M hands | 50M hands | 250M hands |
|---|---|---|---|
| Shards at 5.7M hands each *(limit a)* | **2** | **9** | **44** |
| Disk per shard at that cap | 7.4 GB | 7.4 GB | 7.4 GB |
| Chain rebuild per shard | ~8.6 min | ~8.6 min | ~8.6 min |
| Daily arrivals each shard could absorb *(limit b)* | 150k hands | 150k hands | 150k hands |
| Cluster-wide daily arrival headroom | 300k/day | 1.35M/day | 6.6M/day |

Limit (b) never binds once limit (a) has set the shard count — at 44 shards the cluster absorbs
6.6M hands a day, against a corpus whose densest observed day was ~146k hands. **Scan latency is
the only thing buying nodes here.**

### 7.4 …which is the argument for buying threads before shards

The plan's own open item at the phase-C exit offers two alternatives to sharding: *"more threads
for the pool shard or a street-first projection on `decisions`"*. The repo measured the first one:

> A pure `SELECT` over a week of `marts.decisions` (6.48M rows) went **0.53 s → 0.16 s from 2
> threads to 8** — a 3.3× read speedup for 0.98 GiB more memory
> ([profiles.yml:41-47](../platform/dbt/poker_dwh/profiles.yml#L41-L47)).

So for the population dataset — which is **one tenant, one dataset, and therefore one shard no
matter how many nodes exist** — hash sharding buys *nothing at all*, and eight threads on a single
larger node buys roughly what three shards would, with no fan-out, no initiator merge, no
`GLOBAL IN` on the cohort subquery, and one node to operate. A projection ordered street-first
would buy more again, for disk rather than RAM, and is not measured.

**The recommendation, therefore, refines ADR-025 rather than contradicting it:**

| Workload | Sizing | Why |
|---|---|---|
| **Hero shards** | 4 GB / 2 vCPU, sharded `cityHash64(user_id) % N`, N set by tenant count and disk | hero queries prune to one tenant and answer in 0.05 s; these nodes are bounded by disk and by the 150k-hands/day partition rule, not by scan |
| **The pool shard** | **one node, more vCPU and RAM**, on the reserved tenant id | it is one tenant; shards cannot divide it, threads and a projection can. Give it 8 vCPU and the memory the extra threads cost (measured: +0.98 GiB) before giving it a second node |
| **When the pool outgrows even that** | split by `stake_level` or date range into distinct reserved tenant ids | each becomes its own shard under the *same* unchanged key, which is why §3.2's "a shard is a function of `user_id`" is worth protecting |

---

## 8. What this design does not know

Listed plainly, because a scale document that hides its gaps is worse than none. Every item is
*not measured in this repo*:

1. **Anything multi-node at all.** No `Distributed` table, `remote_servers`, Keeper, or
   `ReplicatedMergeTree` has ever run here. Fan-out latency, initiator merge memory, network cost
   and `optimize_skip_unused_shards` behaviour are reasoning, not results.
2. **`REPLACE PARTITION` under replication** — §4.5. The whole incremental chain rests on it.
3. **Shard-key skew.** One real tenant exists. The "most users under 500k, heavy users at 5–10M"
   distribution is a stated expectation.
4. **Concurrency.** Every latency here is a single query on an idle node. `max_concurrent_queries`
   is 16 but nothing has measured what 16 simultaneous queries cost on a 3.6 GiB budget — and on a
   `Distributed` read the initiator holds every shard's merge state.
5. **CPU.** No `cpus` limit, no per-vCPU figure. The 2-thread measurements are on laptop cores.
6. **The cost of `FINAL`**, on one node or across shards, despite eight `FINAL` sites in
   `api/hand_query.py`.
7. **Kafka**: partition count is unconfigured, worker throughput unmeasured, consumer lag never
   observed, and the ingest-lag metric (F-B02) is explicitly not built.
8. **Postgres and object storage**: no row counts, no bytes, no growth model. The control plane
   (uploads ledger, ranges, analyses, cohorts) is **not sharded by this design** and stays a single
   instance; nothing here says at what size that stops being true.
9. **Re-sharding cost.** Nothing has ever moved a partition between servers, so adding shard N+1 to
   a populated cluster is costed in §6 by replay throughput alone.
10. **Money**, deliberately — §7.

---

## 9. Related

- [ADR-036](POKER_DECISIONS.md#adr-036--shard-by-cityhash64user_id-with-a-reserved-tenant-for-the-pool-buy-threads-before-shards) — the decision this document records
- [ADR-025](POKER_DECISIONS.md#adr-025--freshness-and-scale-materialized-views-generated-from-the-registry-then-shard-by-tenant) — the one-line plan this elaborates
- [ADR-019](POKER_DECISIONS.md#adr-019--the-stat-chain-is-incremental-by-daily-partition-anchored-and-backfilled-in-batches) — daily partitions, the anchored gate, `backfill.py`; every build number here comes from it
- [ADR-009](POKER_DECISIONS.md#adr-009--multi-tenancy-by-tenant-key-not-by-database) — one cluster, one schema, `user_id` leading every `ORDER BY`
- [ADR-013](POKER_DECISIONS.md#adr-013--rent-anything-with-a-replication-protocol) — rent anything with a replication protocol
- [POKER_ARCHITECTURE.md](POKER_ARCHITECTURE.md) — the skew warning, the portability rules
- [POKER_PLAN.md](POKER_PLAN.md) — phase E; the phase-C exit measurement in §4 of the plan
