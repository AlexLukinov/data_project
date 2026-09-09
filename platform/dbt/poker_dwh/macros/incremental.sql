{#
  Shared incremental gate for the whole flag-table chain.

  ## Why partition grain, and not row grain

  Every model here is built with `incremental_strategy='insert_overwrite'`. That strategy
  writes the model's SQL into a temp table, asks `system.parts` which partitions the temp table
  ended up containing, and then issues `ALTER TABLE ... REPLACE PARTITION` for each one.

  **`REPLACE PARTITION` swaps the WHOLE partition.** So the model must emit *every* row that
  belongs in a partition it touches. Filtering on `parsed_at > watermark` -- the obvious thing,
  and what a Postgres-shaped instinct reaches for -- would emit only the newly-parsed hands of
  a day and then replace that day with just them, silently deleting every hand already there.
  The filter therefore has to be at partition granularity: "which DAYS received new data",
  then rebuild those days in full.

  ## Why DAILY, and the constraint that decides it

  The target is a cluster of small, cheap nodes -- ~4 GB each -- not one large server. Peak
  memory is set by the size of ONE partition rebuild, so partition size *is* the memory budget.
  Measured on the real 9.09M-hand corpus, rebuilding `int_hand_player_flags` for one partition:

      monthly, 2024-12    5.9M rows    2.27 GiB   fits
      monthly, 2025-01   20.5M rows    3.06 GiB   FAILS on a 4 GB node
      daily              <=898k rows              comfortable

  2025-01 alone is 38% of the corpus, and no amount of thread- or cache-tuning rescues it:
  16 -> 4 -> 2 threads moved the peak 2.92 -> 3.06 GiB (it got *worse*, because the cost is the
  20.5M x 155-column output, not parallelism). The partition has to be smaller.

  **Daily was tried once before and rejected -- for a reason that no longer applies.** With a
  one-shot `dbt build --full-refresh`, all 164 partitions are written by a single INSERT, and
  ClickHouse holds a write buffer *per column, per open part*: 155 columns x 164 parts is tens
  of GB, and `int_postflop_context` duly demanded >11.18 GiB. That failure was specific to the
  one-shot path. `scripts/backfill.py` writes ONE partition per pass, so the buffers never
  multiply, and the full refresh is not used to bootstrap any more.

  Consequence, deliberately left in place: `max_partitions_per_insert_block` stays at its
  default of 100. An unbatched run over a freshly re-imported archive therefore fails fast with
  a clear "too many partitions" error instead of exhausting memory -- which is the signal you
  want, pointing at `scripts/backfill.py`.

  ## Why not append + ReplacingMergeTree

  Because a re-parse can change a sort-key column. Parser bug #4 (see docs/POKER_STATUS.md) did
  exactly that: it corrected `player_key` for 6.2% of GGPoker seats, which moves the row to a
  different position in the ORDER BY. ReplacingMergeTree only collapses rows sharing a sort
  key, so `append` would have left two rows per seat that never merge. Replacing the partition
  is correct regardless of which columns changed.

  ## The watermark

  `core.hands.parsed_at` -- already present on hands/hand_players/actions, and already the
  ReplacingMergeTree version column, so it is the timestamp the rest of the system already
  treats as "when did we learn this".

  ## The watermark is PER PARTITION, and that is not a refinement

  An earlier version compared one global `max(src_parsed_at)` for the whole table. It silently
  skipped partitions, because ingest order and partition order are unrelated:

      partition     hands     first parsed_at
      2024-12-xx    972,943   05:43:13
      2023-08-29          1   05:46:29   <- one hand, ingested LAST

  Build the 2023 partition and the global watermark jumps to 05:46:29, at which point the
  972,943 hands ingested three minutes earlier no longer look dirty and are never built.
  Observed: the pending count fell from 10 to 6 after a single partition was processed.

  Comparing each partition's own `max(parsed_at)` in core against that same partition's
  `max(src_parsed_at)` is both correct and free: ClickHouse answers it from per-part min/max
  metadata in ~20 ms rather than scanning 54M rows. It also detects a partition that was never
  built at all, which a time-only watermark cannot express.

  ## Every model reads the SAME anchor, not its own table

  The built-side subquery is pinned to `marts.stats_daily` -- **the LAST model in the chain**
  -- for every model, rather than to `{{ this }}`. It must be the last one: an earlier version
  anchored on `marts.player_hand_flags`, and `stats_daily`, which builds *after* it in the same
  pass, then saw every partition as already built and stayed empty for good -- the API's
  rollup route silently answered "0 hands". Two more failures forced the shared anchor, both
  silent:

  1. **Divergence after a failed pass.** With per-model state, upstream models that succeeded
     advanced while the failed downstream one did not. The next pass then had each model pick a
     *different* oldest-N set, so `int_hand_player_flags` built day X while
     `int_postflop_context` had not yet -- the LEFT JOIN found nothing and every c-bet counter
     for that day silently came out ZERO. Measured: pool c-bets 1,824,127 -> 626,804, and hero
     c-bets 0.
  2. **Permanently unsatisfiable partitions.** `int_postflop_context` and `int_board_texture`
     only hold hands that saw a flop. A day with no flop produces no rows, so that partition
     never appears in their output and stays "dirty" forever. With `order by m limit N` the
     batch then re-selected the same stuck days every pass and never reached the real work:
     they ended at 107 partitions where the rest of the chain had 160.

  Anchoring the selection removes both: every model in a pass rebuilds the same set, dbt's
  dependency order guarantees upstream fills it before downstream reads it, and a model with
  nothing to write for a partition simply writes nothing without blocking progress. An upstream
  model rebuilding a partition it already had is idempotent and cheap.

  The anchor is written as a literal relation, NOT `ref()`, because a `ref()` from an upstream
  model to a downstream one is a cycle in dbt's DAG. `scripts/backfill.py` must query the same
  anchor -- if the two disagree the loop stops while work remains.

  ## Several anchors: bootstrapping a second chain beside the first (plan C.2)

  `anchors` is a var: a list of `[table, date column]` pairs under `marts`, default
  `[[stats_daily, day]]`. With more than one, a partition counts as built only when EVERY
  listed table has it (`having count() = N`), and its watermark is the OLDEST of theirs. That
  is what lets the v2 facts (`decisions`, `player_hands` -- siblings, neither downstream of
  the other) fill in over a fully built v1 chain without touching it:

      dbt run --full-refresh --select +decisions +player_hands --vars 'empty_chain: true'
      uv run python -m scripts.backfill --anchor decisions:played_date \
          --anchor player_hands:played_date --select '+decisions +player_hands'

  A pass that builds `decisions` and then fails on `player_hands` leaves the partition dirty
  for both, so the next pass redoes it. Once the generated `stats_daily` reads both (C.3) it is
  again the single last model and the default anchor applies.

  A half-failed run is still self-healing: the anchor only advances for a partition once
  `marts.stats_daily` itself has been written for it, which happens last, so a failure
  anywhere in the chain leaves that partition dirty and the next pass redoes the whole set.
  If a model is ever added downstream of `stats_daily`, the anchor moves to it.

  ## Bootstrapping on a small server: `batch_partitions`

  Peak memory is set by the SIZE OF ONE RUN, not by the size of the table. Routine traffic is
  therefore cheap -- a player uploading a session dirties one or two days -- but a first load,
  or a re-import of a large archive, dirties every day at once and would need many GB in a
  single shot (and would trip max_partitions_per_insert_block first).

  Rather than sizing the server for that one-off, cap how many partitions a run will take:

      dbt build --vars 'batch_partitions: 1'   # repeat until it reports nothing to do

  Each pass rebuilds the oldest N dirty partitions and advances that partition's watermark, so
  looping converges. This is what lets a 4 GB node bootstrap a corpus it could never rebuild in
  one query, and it is why production is a cluster of small nodes rather than one big one --
  see `scripts/backfill.py`.

  Leave the var unset for normal operation: every dirty partition in one pass, which is what
  you want when there is one of them.

  ## Changing the chain's DDL (a column type, a new column, a partition key)

  `insert_overwrite` swaps partitions between the temp table and the target, so the two must
  have identical structure -- a model whose SELECT now yields a different column type fails at
  REPLACE PARTITION, and a new column is silently dropped (`on_schema_change` is unset). The
  procedure, in this order:

      CLICKHOUSE_PORT=8124 .venv-dbt/bin/dbt run --full-refresh --vars 'empty_chain: true' \
          --project-dir dbt/poker_dwh --profiles-dir dbt/poker_dwh
      uv run python scripts/backfill.py

  With `empty_chain: true` this macro returns the constant `0`, so every model's gate is
  false and the full refresh creates each table from its own SELECT with the right DDL and
  no rows, in seconds; the backfill then fills it a few partitions at a time. (dbt's own
  `--empty` flag was tried for this and does not work here: it appends its own alias to every
  limited ref, which collides with the `{{ ref() }} as p` aliases the models need.)

  NEVER `--full-refresh` a populated corpus without that var: that is the one-shot CTAS this
  whole design exists to avoid, and it needs 7+ GiB.
#}

{% macro dirty_partitions(column='played_at_utc') %}
  {%- if var('empty_chain', false) -%}
    {#- Always false, but written against the column rather than as a bare `0`: a constant
        in a JOIN ON clause is rejected under the grace_hash/partial_merge join algorithms
        set in infra/clickhouse/limits.xml ("JOIN ON constant supported only with 'hash'"). -#}
    toYYYYMMDD({{ column }}) = 0
  {%- elif is_incremental() -%}
    {%- set batch = var('batch_partitions', 0) | int -%}
    toYYYYMMDD({{ column }}) in (
        select src.m
        from (
            select toYYYYMMDD(played_at_utc) as m, max(parsed_at) as src_max
            from {{ source('core', 'hands') }}
            group by m
        ) as src
        left join (
            {{ anchor_built() }}
        ) as built on built.m = src.m
        {# An UNBUILT partition has no row on the right, and ClickHouse pads the miss with the
           type's ZERO (the 1970 epoch) rather than NULL -- so `src_max > built_max` is true
           for it, which is exactly what we want. This is the one place that zero-padding is
           relied on deliberately; everywhere else it is the bug documented in
           docs/POKER_STATUS.md, so the dependency is called out rather than left implicit. #}
        where src.src_max > built.built_max
        {%- if batch > 0 %}
        order by src.m
        limit {{ batch }}
        {%- endif %}
    )
  {%- else -%}
    1
  {%- endif -%}
{% endmacro %}


{#- The built side of the gate: per partition, the watermark of the anchor table(s). -#}
{% macro anchor_built() -%}
  {%- set anchors = var('anchors', [['stats_daily', 'day']]) -%}
  {%- if anchors | length == 1 -%}
    select toYYYYMMDD({{ anchors[0][1] }}) as m, max(src_parsed_at) as built_max
    from {{ db_prefix() }}marts.{{ anchors[0][0] }}
    group by m
  {%- else -%}
    select m, min(built_max) as built_max
    from (
      {%- for anchor in anchors %}
        select toYYYYMMDD({{ anchor[1] }}) as m, max(src_parsed_at) as built_max
        from {{ db_prefix() }}marts.{{ anchor[0] }}
        group by m
        {%- if not loop.last %} union all {%- endif %}
      {%- endfor %}
    )
    group by m
    having count() = {{ anchors | length }}
  {%- endif -%}
{%- endmacro %}
