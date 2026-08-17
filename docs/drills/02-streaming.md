# 02 — Streaming

Kafka internals · delivery semantics · the ClickHouse Kafka-engine path · windowing & late data ·
schema registry. Helpers (`CH`, `KAF`, `CHSH`) are in [README.md](README.md). Bring this path up
with `make streaming && make stream-on`.

---

## Kafka internals

### [B] Q: Partitions, consumer groups, offsets — explain with this lab.
**Talking points:**
- A topic is split into **partitions** (the `clickstream` topic has 3) — the unit of parallelism and
  ordering (order is guaranteed *within* a partition, not across).
- A **consumer group** divides partitions among its members; each partition is consumed by exactly
  one member of a group. Add consumers up to #partitions to scale; beyond that they idle.
- **Offsets** are per-(group, partition) cursors committed back to Kafka so a restart resumes.
**Show it in the lab:** ClickHouse consumes as group `ch-clickstream` (see [infra/clickhouse/kafka-tables.sh](../../infra/clickhouse/kafka-tables.sh)).
```bash
KAF /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic clickstream
KAF /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group ch-clickstream
```
The second shows CURRENT-OFFSET / LOG-END-OFFSET / **LAG** per partition. Also visible in Kafka-UI
(`localhost:8081`).
**Follow-up:** "5 consumers, 3 partitions?" → 2 sit idle; partitions cap consumer parallelism.

### [I] Q: How does the producer choose a partition? What changes with a key?
**Talking points:** no key → sticky/round-robin batching across partitions (the lab's `producer.py`
produces with **no key**). With a key → `hash(key) % partitions`, so all events for a key land on one
partition → ordering per key (e.g. per user) and co-location, at the risk of skew (hot keys).
**Show it in the lab:** [generator/producer.py](../../generator/producer.py) `producer.produce(TOPIC, json...)` — no key arg.
To get per-user ordering you'd pass `key=str(user_id)`.
**Follow-up:** "downside of keying by user_id?" → partition skew if some users are very hot; ordering
guarantee only matters if downstream cares about per-user sequence.

### [I] Q: Replication factor and `min.insync.replicas` — what's the lab running and what's prod?
**Talking points:** RF = #copies of each partition across brokers; `min.insync.replicas` (with
`acks=all`) = how many must ack a write to succeed. Lab is **1 broker, RF=1** (no redundancy — fine
for local). Prod: RF=3, `min.insync.replicas=2`, `acks=all` → survive one broker loss with no data
loss.
**Show it in the lab:** [infra/kafka/topic.yaml](../../infra/kafka/topic.yaml) (`replicas: 1`) and the single `platform-dual-0` broker.
```bash
KAF /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic clickstream   # ReplicationFactor: 1
```
**Follow-up:** "RF=3 but min.isr=3 and one broker down?" → producers with `acks=all` block/fail —
that's why min.isr is set *below* RF.

### [I] Q: What's a rebalance and why is it disruptive?
**Talking points:** when group membership/partition count changes, Kafka reassigns partitions; older
"stop-the-world" rebalances pause all consumers. Mitigations: cooperative/incremental rebalancing,
static membership (`group.instance.id`), tuned `session.timeout.ms`/`max.poll.interval.ms`.
**Show it in the lab:** scale the generator and watch the group settle:
```bash
make stream-off && make stream-on
KAF /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group ch-clickstream
```
**Follow-up:** "consumer does slow work and gets kicked?" → it missed `max.poll.interval.ms`; raise
it or process async.

---

## Delivery semantics

### [I] Q: At-least-once vs exactly-once — where does this lab sit?
**Talking points:**
- Default producer/consumer = **at-least-once**: retries + offset-commit-after-processing can
  duplicate on failure. The lab's path is at-least-once (plain producer, CH Kafka engine commits
  offsets after batches).
- **Exactly-once** needs the idempotent producer (`enable.idempotence=true`) + transactions, or an
  idempotent sink (dedup on a key). Cheapest practical pattern for analytics: at-least-once +
  dedup downstream by a unique id.
**Show it in the lab (build-it snippet):** dedup `raw.events` by `event_id` with ReplacingMergeTree.
```sql
-- in CHSH
CREATE TABLE raw.events_dedup (event_id String, user_id UInt32, event_type LowCardinality(String),
  page String, ts DateTime) ENGINE=ReplacingMergeTree ORDER BY event_id;
INSERT INTO raw.events_dedup SELECT * FROM raw.events;
SELECT count() AS raw, (SELECT count() FROM raw.events_dedup FINAL) AS deduped FROM raw.events;
```
**Follow-up:** "FINAL is expensive at query time?" → yes; alternatives are a periodic `OPTIMIZE …
FINAL`, or `argMax`/`GROUP BY event_id` in the read.

### [A] Q: How would you make the *producer* exactly-once?
**Talking points:** `enable.idempotence=true` (dedupes retries within a partition via producer id +
sequence numbers) and, for multi-partition atomic writes, transactions
(`init_transactions`/`begin`/`commit`). End-to-end EOS also needs the consumer to read
`isolation.level=read_committed` and commit offsets inside the transaction.
**Show it in the lab:** conceptual — `producer.py` uses confluent-kafka; you'd add
`{'enable.idempotence': True}` to the producer config and wrap sends in a transaction.
**Follow-up:** "cost?" → throughput/latency overhead + complexity; most analytics pipelines pick
at-least-once + idempotent sink instead.

---

## ClickHouse Kafka-engine path

### [I] Q: Trace an event from the generator to a queryable row.
**Talking points:** `producer.py` → topic `clickstream` → **Kafka-engine table** `raw.kafka_clickstream`
(a consumer, *not* storage — selecting from it consumes) → **materialized view** `raw.mv_events`
fires on each consumed block → inserts into the **MergeTree** `raw.events` (the durable, queryable
table). The MV is the glue; the Kafka table is the mouth, the MergeTree is the stomach.
**Show it in the lab:** [infra/clickhouse/kafka-tables.sh](../../infra/clickhouse/kafka-tables.sh).
```bash
CH "SELECT count() FROM raw.events"      # run twice with generator on → grows
CH "SELECT event_type, count() FROM raw.events GROUP BY event_type ORDER BY 2 DESC"
```
**Follow-up:** "why not query `raw.kafka_clickstream` directly?" → each SELECT consumes messages and
advances offsets; you'd steal data from the MV. Treat Kafka-engine tables as write-only inputs.

### [I] Q: The event JSON has a `ts` string — how does CH parse it, and what's the format gotcha?
**Talking points:** `kafka_format='JSONEachRow'` maps JSON fields to columns by name; the `ts` string
`"YYYY-MM-DD HH:MM:SS"` parses into `DateTime`. Mismatched/missing fields or bad datetime formats
cause parse errors that can stall the consumer (tune `kafka_skip_broken_messages`).
**Show it in the lab:** producer emits `datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")`; table col is
`ts DateTime`.
```bash
CH "SELECT max(ts), now(), now()-max(ts) AS lag_seconds FROM raw.events"
```
**Follow-up:** "a malformed message arrives?" → without `kafka_skip_broken_messages>0` the consumer
errors and retries the block; set it (or route to a DLQ topic) for resilience.

### [A] Q: Tuning the CH Kafka consumer — what knobs matter?
**Talking points:** `kafka_num_consumers` (parallel consumers within the table, ≤ partitions),
`kafka_max_block_size` (rows per insert block → fewer, bigger MergeTree parts), `kafka_poll_max_batch_size`,
`kafka_flush_interval_ms`. Goal: large enough blocks to avoid the *too-many-small-parts* problem.
**Show it in the lab:** the lab uses defaults; you'd add these in the `SETTINGS` of `raw.kafka_clickstream`.
```bash
CH "SELECT count() AS active_parts FROM system.parts WHERE database='raw' AND table='events' AND active"
```
Many tiny parts = block size too small / flush too frequent.
**Follow-up:** "consumer lag climbing?" → add consumers up to #partitions, bigger blocks, or scale
the broker; check `kafka-consumer-groups --describe` LAG.

---

## Windowing & late data

### [I] Q: Tumbling vs sliding/hopping windows — compute a per-minute event count.
**Talking points:** tumbling = fixed, non-overlapping buckets; hopping/sliding = overlapping
(advance < size). Aggregate by a time bucket; in CH use `toStartOfMinute`/`toStartOfInterval` (or
`tumble`/`hop` table functions).
**Show it in the lab:**
```bash
CH "SELECT toStartOfMinute(ts) AS minute, count() FROM raw.events GROUP BY minute ORDER BY minute DESC LIMIT 5"
```
**Follow-up:** "5-minute hopping advancing 1 min?" → `toStartOfInterval(ts, INTERVAL 5 MINUTE)` won't
overlap; for true hopping use the `hop()` window-view function.

### [A] Q: Event-time vs processing-time and late data — how do you handle it?
**Talking points:** event-time = when it happened (`ts` in the payload); processing-time = when it's
ingested. Out-of-order/late events need **watermarks** (how long to wait) and a late-data policy
(drop, side-output, or allow updates). ClickHouse stores both implicitly — late events just land in
the right `ts` bucket on the next aggregate recompute, which is forgiving vs strict streaming engines.
**Show it in the lab:**
```bash
CH "SELECT max(now() - ts) AS max_lateness_seconds FROM raw.events"
```
**Follow-up:** "Flink/Spark Structured Streaming vs CH here?" → those make watermarks/allowed-lateness
explicit and emit incremental window results; CH's MV + periodic aggregate is simpler but less
precise about window completeness.

---

## Schema registry & evolution

### [I] Q: The events are JSON. What does a schema registry buy you, and what breaks without one?
**Talking points:** a registry (Confluent/Apicurio) stores Avro/Protobuf/JSON-Schema with an id; the
producer serializes against it and the consumer fetches the schema by id → compact binary, enforced
**compatibility** (backward/forward/full) so a producer can't silently break consumers. Plain JSON
(the lab) is human-readable but unenforced — a renamed field just yields nulls downstream.
**Show it in the lab:** [generator/producer.py](../../generator/producer.py) emits `json.dumps(event)`; CH parses by field name.
Add a field and watch CH ignore it (null/absent), proving the lack of enforcement:
```bash
CH "SELECT * FROM raw.events ORDER BY ts DESC LIMIT 3"
```
**Follow-up:** "backward vs forward compatibility?" → backward = new consumer reads old data
(add optional/defaulted fields); forward = old consumer reads new data (don't remove fields they
need). Full = both.
