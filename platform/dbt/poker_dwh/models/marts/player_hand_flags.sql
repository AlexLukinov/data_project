{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='ReplacingMergeTree(parsed_at)',
    order_by='(user_id, dataset, player_key_norm, played_at_utc, hand_uid, seat)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

-- The per-hand flag fact, persisted.
--
-- **This is the table arbitrary custom reports read.** `stats_daily` is a deliberately coarse
-- rollup for the dashboard's hot path; it cannot carry the fine dimensions (hand class, board
-- texture, SPR, bet size) because putting them in its GROUP BY would push its row count up to
-- roughly this table's and make the rollup pointless. So anything sliced by those lands here,
-- on the full per-hand grain, and ClickHouse scans it. See api/queries.py `_source_for`.
--
-- Sort key differs from core.* on purpose: core tables are read by hand_uid (the replayer,
-- re-parse), this table is read by stat queries, which filter by user AND player over a date
-- range. `user_id` still leads -- that never changes -- and `dataset` comes immediately after,
-- so a hero-only query never touches a single pool granule.
--
-- The sort key uses `player_key_norm`, NOT `player_key`: ClickHouse refuses nullable sorting
-- key columns (allow_nullable_key is off by default, and rightly so -- NULL ordering in a
-- sparse primary index is a footgun). Anonymized opponents (GGPoker) therefore get '' in
-- `player_key_norm` while `player_key` stays NULL -- which is what the downstream
-- opponent-stat gate keys off. Their rows then aggregate together into population data
-- rather than into a fictional player who exists in exactly one hand.

-- `parsed_at` here is the BUILD time, and exists only as the ReplacingMergeTree version so a
-- later build of the same rows wins. It is NOT the ingestion watermark -- that is
-- `src_parsed_at`, carried through from core.hands by `*`, and it is what the incremental gate
-- reads. Conflating the two would freeze the watermark at the last build instead of the last
-- ingest, and the model would then never see new hands.
select
    *,
    coalesce(player_key, '') as player_key_norm,
    now64(3) as parsed_at
from {{ ref('int_hand_player_flags') }}
where {{ dirty_partitions('played_at_utc') }}
