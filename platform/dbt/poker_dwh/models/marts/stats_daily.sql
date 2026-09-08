{{
  config(
    materialized='table',
    engine='AggregatingMergeTree()',
    order_by='(user_id, player_key, day, site, stake_level, position)',
    partition_by='toYYYYMM(day)',
  )
}}

-- Daily stat rollup — what the API and dashboard actually read.
--
-- `AggregatingMergeTree` with SimpleAggregateFunction-shaped sums: every counter here is
-- additive, so plain `sum()` states are correct and much cheaper than -State/-Merge blobs.
-- Reserve AggregateFunction for the non-additive ones (uniq, quantiles) when they arrive.
--
-- **Phase 1 builds this in batch, via dbt.** Phase 2 (feature F-202) adds a ClickHouse
-- MATERIALIZED VIEW with this same SELECT so the rollup updates incrementally on insert and
-- stats are fresh seconds after an upload with no orchestrator involved. The two-tier design
-- is ADR-003: dbt owns the definition and the tests, the MV owns the hot path. Keeping the
-- SELECT here as the single source means the MV can be generated from it rather than
-- hand-copied into a second, drifting version.

select
    user_id,
    player_key_norm                     as player_key,
    toDate(played_at_utc)               as day,
    site,
    stake_level,
    game_type,
    table_format,
    position,
    is_hero,
    is_anonymized,

    sum(hands)                          as hands,

    sum(vpip_opp)                       as vpip_opp,
    sum(vpip_action)                    as vpip_action,
    sum(pfr_opp)                        as pfr_opp,
    sum(pfr_action)                     as pfr_action,
    sum(threebet_opp)                   as threebet_opp,
    sum(threebet_action)                as threebet_action,
    sum(fold_to_3bet_opp)               as fold_to_3bet_opp,
    sum(fold_to_3bet_action)            as fold_to_3bet_action,
    sum(fourbet_opp)                    as fourbet_opp,
    sum(fourbet_action)                 as fourbet_action,
    sum(steal_opp)                      as steal_opp,
    sum(steal_action)                   as steal_action,
    sum(fold_bb_steal_opp)              as fold_bb_steal_opp,
    sum(fold_bb_steal_action)           as fold_bb_steal_action,
    sum(cbet_flop_opp)                  as cbet_flop_opp,
    sum(cbet_flop_action)               as cbet_flop_action,
    sum(cbet_turn_opp)                  as cbet_turn_opp,
    sum(cbet_turn_action)               as cbet_turn_action,
    sum(fold_to_cbet_f_opp)             as fold_to_cbet_f_opp,
    sum(fold_to_cbet_f_action)          as fold_to_cbet_f_action,
    sum(checkraise_f_opp)               as checkraise_f_opp,
    sum(checkraise_f_action)            as checkraise_f_action,
    sum(wwsf_opp)                       as wwsf_opp,
    sum(wwsf_action)                    as wwsf_action,
    sum(wtsd_opp)                       as wtsd_opp,
    sum(wtsd_action)                    as wtsd_action,
    sum(wsd_opp)                        as wsd_opp,
    sum(wsd_action)                     as wsd_action,

    sum(net_won_bb)                     as net_won_bb,
    sum(ev_won_bb)                      as ev_won_bb,
    sum(showdown_won_bb)                as showdown_won_bb,
    sum(nonshowdown_won_bb)             as nonshowdown_won_bb

from {{ ref('player_hand_flags') }}
group by
    user_id, player_key, day, site, stake_level, game_type,
    table_format, position, is_hero, is_anonymized
