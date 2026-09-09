-- ★ THE DECISION FACT: one row per decision point, with the state before it (ADR-020).
--
-- Any situation is a predicate over one of these rows, and any situation stat is
-- countIf(situation AND action) / countIf(situation). That is what replaces the 156-column
-- flag table: a new stat is a registry entry, a new situation is a filter, and neither touches
-- this model. The columns are the contract in stats/registry/dimensions.yaml; the SELECT is
-- macros/decision_state.sql (see there for why it is a macro).
--
-- Sort key: `user_id` leads, then `dataset` so a hero-only query never touches a pool granule,
-- then `player_key_norm` (every opponent report filters on it), `street` (most stats fix one),
-- the day, and the hand and action for locality. `player_key_norm` rather than `player_key`
-- because ClickHouse refuses a Nullable sort key; anonymized seats get '' and aggregate as
-- population, `player_key` stays NULL for the opponent-stat gate.
--
-- Same daily partitions and dirty-partition gate as the rest of the chain (ADR-019).

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, dataset, player_key_norm, street, played_date, hand_uid, action_index)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

{{ decision_state() }}
