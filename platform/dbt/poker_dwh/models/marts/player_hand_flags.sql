{{
  config(
    materialized='table',
    engine='ReplacingMergeTree(parsed_at)',
    order_by='(user_id, player_key_norm, played_at_utc, hand_uid, seat)',
    partition_by='toYYYYMM(played_at_utc)',
  )
}}

-- The per-hand flag fact, persisted.
--
-- Sort key differs from core.* on purpose: core tables are read by hand_uid (the replayer,
-- re-parse), this table is read by stat queries, which filter by user AND player over a date
-- range. `user_id` still leads -- that never changes -- but `player_key` comes second here.
--
-- The sort key uses `player_key_norm`, NOT `player_key`: ClickHouse refuses nullable sorting
-- key columns (allow_nullable_key is off by default, and rightly so -- NULL ordering in a
-- sparse primary index is a footgun). Anonymized opponents (GGPoker) therefore get '' in
-- `player_key_norm` while `player_key` stays NULL -- which is what the downstream
-- opponent-stat gate keys off. Their rows then aggregate together into population data
-- rather than into a fictional player who exists in exactly one hand.

select
    *,
    coalesce(player_key, '') as player_key_norm,
    now64(3) as parsed_at
from {{ ref('int_hand_player_flags') }}
