# Observability — two different things with the same name

> Companion docs: [POKER_GAP_ANALYSIS.md](POKER_GAP_ANALYSIS.md) · [POKER_ARCHITECTURE.md](POKER_ARCHITECTURE.md) · [POKER_ROADMAP.md](POKER_ROADMAP.md)
>
> A plan, not an implementation.

"Monitoring stats" means two unrelated things in this product, and conflating them leads to
building the wrong one first.

| | **(A) Product stats monitoring** | **(B) Platform observability** |
|---|---|---|
| Who looks at it | The player | You |
| Question it answers | "Is my game improving?" | "Is the pipeline healthy?" |
| Data source | ClickHouse stat marts | Prometheus, logs, ClickHouse system tables |
| Failure means | A user makes a bad strategy decision | Users get stale or wrong data and you don't know |
| When | **MVP** — it *is* the product | Minimal at MVP, real from Phase 6 |

---

## (A) Product stats monitoring — the player-facing dashboards

This is a **product feature**, not infrastructure. It's what the user pays for.

**Phase 1 (SQL-verifiable), Phase 2.5 (in a browser):**

- **Stat table** — VPIP, PFR, 3-Bet%, Fold-to-3Bet, C-Bet Flop, WWSF, WTSD, bb/100 — sliceable
  by position, stake level, site, table size, and date range.
- **Win-rate timeline** — bb/100 over time, cumulative and windowed.
- **Session summaries** — hands, duration, result, biggest pots.
- **Stat trend deltas** — this month vs. last, so a leak developing is visible before it's expensive.

**Two honesty features that are not optional:**

1. **Always display the sample size next to every stat.** A 3-bet% over 40 opportunities is
   noise. Showing it as "8.2%" without context is the product actively misleading its user.
2. **Show a confidence interval on bb/100.** Poker win-rate variance is enormous: "+4 bb/100 over
   8,000 hands" has a true value plausibly anywhere from about −3 to +11. Most trackers present
   point estimates with false precision. Getting this right is a genuine differentiator, and it
   costs one extra column in a query.

**Later (Phase 5):** leak alerts driven by the deviation scorer — "your fold-to-3bet from the
button has drifted 9 points in 30 days."

**Where it comes from:** ClickHouse `marts.stats_daily` through Redis through FastAPI. Nothing
special. The dashboard is a thin read layer over the rollups described in
[POKER_DATA_MODEL.md §4.4](POKER_DATA_MODEL.md#44-rollups--aggregatingmergetree--materialized-views).

---

## (B) Platform observability — is the pipeline healthy

### The MVP tier (Phases 1–2.5) — do this much, no more

You are one person. Sixty dashboards you never open are worse than four you trust.

1. **Structured JSON logging** from every service, with a correlation id (`request_id`,
   `user_id`, `upload_id`) threaded from the API through the worker to the ClickHouse insert.
   This single discipline is worth more than any dashboard: it turns "an upload failed somewhere"
   into one query.
2. **The `uploads` table in Postgres is your first observability tool.** It already records
   status, `hands_found`, `hands_parsed`, `hands_failed`, and `error_text`. A `GROUP BY status,
   site` over the last 24 hours answers most operational questions for free.
3. **The dead-letter topic is a product backlog, not an error log.** Every unparseable hand is a
   parser bug with a reproducible input attached. Review it weekly; it will drive your parser
   roadmap more reliably than guessing which site to support next.
4. **ClickHouse `system.*` tables**, checked manually: `system.parts` (part count per table —
   the `TOO_MANY_PARTS` early warning), `system.query_log` (slow queries), `system.merges`
   (merge backlog). No exporter needed to start.

### The real tier (Phase 6) — Prometheus + Grafana

Standard stack: Prometheus scraping, Grafana dashboards, Alertmanager routing. Add
OpenTelemetry traces from FastAPI through the workers when you have more than two services and
"where did the time go" stops being obvious.

**Metrics that actually matter, by layer:**

| Layer | Metric | Why |
|---|---|---|
| **Ingest** | `ingest_lag_seconds` — upload accepted → hand queryable | ★ **The single most important number in the system.** It's the user's experience of "did my upload work" |
| | `parse_throughput_hands_per_sec`, by site | Capacity planning; a sudden drop means a format changed |
| | `parse_error_rate`, by site and parser version | ★ A site changing its format shows up here first |
| | `deadletter_rate` | Same signal, different angle |
| **Kafka** | consumer lag per group | ★ Rising lag = workers can't keep up. The earliest warning of an ingest backlog |
| | partition skew | One heavy user monopolizing a partition |
| **ClickHouse** | query p50/p95/p99 by endpoint | The user-facing latency SLO |
| | active parts per table | `TOO_MANY_PARTS` is preceded by a visible climb |
| | merge backlog, `ReplacingMergeTree` dedup lag | Stale `FINAL` reads |
| | disk usage, hot vs. S3 tier | Cost and capacity |
| | per-tenant query cost | Finds the noisy neighbour before they find you |
| **Redis** | hit rate, evictions | A collapsing hit rate means the cache key design is wrong |
| **dbt** | model runtimes, **test pass/fail** | ★ A failing test means users may be seeing wrong numbers |
| **Airflow** | DAG success rate, task duration trend | Standard |
| **API** | request rate, error rate, p95 latency, auth failures | Standard, plus auth failures as a security signal |
| **Business** | uploads/day, hands/day, active users, hands per user | Product health, and it shares the same plumbing |

### The six alerts

A solo maintainer needs a handful of alerts that are *always* worth waking up for. Everything
else is a dashboard you look at deliberately.

1. **Ingest lag > 10 minutes** — uploads are backing up; users are waiting.
2. **Parse error rate > 5% for any site over 1 hour** — that site almost certainly changed its
   format.
3. **Any dbt test failing** — users may be looking at wrong statistics. This is the most
   damaging failure mode in an analytics product, because nothing looks broken.
4. **ClickHouse query p95 > 2 s** — the dashboard is becoming unusable.
5. **Kafka consumer lag growing for > 15 minutes** — workers are losing ground, not just behind.
6. **Any disk > 80%** — the boring one that takes everything down at 3 a.m.

Note that #3 has no infrastructure symptom at all. Every service is green; the numbers are just
wrong. That's why data-quality tests belong in the alerting path and not only in CI.

### Data quality as observability

dbt tests are runtime monitoring, not just build-time checks. The two singular tests from
[POKER_DATA_MODEL.md §8](POKER_DATA_MODEL.md#8-dbt-project-layout) —
`assert_vpip_gte_pfr` and `assert_flags_le_opportunities` — encode laws of poker. If either
fires, the flag logic is broken and every downstream stat is suspect. Alongside them, add
**source freshness** checks (no new hands for a user who's actively uploading) and
**reconciliation** between the ClickHouse MV output and a full dbt rebuild for a sample window
— that's the drift detector for the two-tier design in
[ADR-003](POKER_DECISIONS.md#adr-003--dbt-owns-the-stat-definitions-clickhouse-mvs-own-the-hot-path).

---

## What the lab has today, and what it doesn't

The cluster runs `metrics-server` and nothing else. The 13 [smoke tests](../scripts/smoke/) are
an excellent **deployment** check and not a **runtime** monitor — they verify a component is up,
not that ingest lag is climbing. That distinction is the whole gap.

The lab is a reasonable place to learn the Prometheus/Grafana stack (kube-prometheus-stack
installs cleanly and the ClickHouse and Strimzi exporters both exist), but per
[ADR-013](POKER_DECISIONS.md#adr-013--rent-anything-with-a-replication-protocol) production
monitoring is another thing worth renting — Grafana Cloud's free tier covers a system this size,
and running your own monitoring stack means the thing that tells you the platform is down shares
a failure domain with the platform.

---

## Sequencing

| Phase | Observability work |
|---|---|
| 1–2 | Structured logs with correlation ids; the `uploads` table; dead-letter review; manual `system.*` checks |
| 2.5 | API request logging; the ingest-lag metric, even if you only read it by hand |
| 4 | dbt test failures wired to an alert (Airflow is there to run them) |
| 6 | Prometheus + Grafana, the six alerts, OpenTelemetry traces |
| 7 | Agent-side telemetry: connection health, hands/minute, overlay render latency |

**The one thing to start immediately:** correlation ids in structured logs. It costs almost
nothing on day one and is painful to retrofit across five services later.
