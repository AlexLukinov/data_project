{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='SummingMergeTree()',
    order_by='(user_id, dataset, player_key, day, site, stake_level, game_type, table_format, position, is_hero, is_anonymized)',
    partition_by='toYYYYMMDD(day)',
  )
}}

-- Daily stat rollup — what the API and dashboard actually read.
--
-- `SummingMergeTree`, and **every GROUP BY key is in the ORDER BY**. Both matter: the engine
-- merges rows that share a sort key, so a group key missing from the sort key makes two
-- distinct groups collapse into one on merge (an earlier version left four keys out and
-- relied on insert_overwrite never producing two rows per key -- docs/POKER_AUDIT.md B5), and
-- SummingMergeTree adds the counters when it does merge, which is the correct semantics for
-- the incremental materialized-view path of F-202. Reserve AggregateFunction states for the
-- non-additive stats (uniq, quantiles) when they arrive.
--
-- **Every counter on the flag table is rolled up here.** `api/queries.py` routes a query to
-- this table whenever its dimensions allow, so a counter present there but absent here fails
-- at runtime with UNKNOWN_IDENTIFIER (29 leak counters were once stranded that way -- B3).
--
-- **Phase 1 builds this in batch, via dbt.** Phase 2 (feature F-202) adds a ClickHouse
-- MATERIALIZED VIEW with this same SELECT so the rollup updates incrementally on insert and
-- stats are fresh seconds after an upload with no orchestrator involved. The two-tier design
-- is ADR-003: dbt owns the definition and the tests, the MV owns the hot path. Keeping the
-- SELECT here as the single source means the MV can be generated from it rather than
-- hand-copied into a second, drifting version.

-- **Deliberately COARSE.** Only dimensions with small, stable cardinality belong in this
-- GROUP BY. The fine ones (hand_class at 169 values, board texture, SPR, bet size) would
-- multiply the row count until the rollup was no smaller than the fact table it summarizes --
-- at which point it costs storage and buys nothing. Queries needing those read
-- `player_hand_flags` directly; `api/queries.py` routes between the two automatically.

select
    user_id,
    dataset,
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

    -- ---- preflop, added with the wide-flag expansion ----------------------------------
    sum(rfi_opp)                        as rfi_opp,
    sum(rfi_action)                     as rfi_action,
    sum(limp_opp)                       as limp_opp,
    sum(limp_action)                    as limp_action,
    sum(iso_opp)                        as iso_opp,
    sum(iso_action)                     as iso_action,
    sum(cold_call_opp)                  as cold_call_opp,
    sum(cold_call_action)               as cold_call_action,
    sum(squeeze_opp)                    as squeeze_opp,
    sum(squeeze_action)                 as squeeze_action,
    sum(call_3bet_opp)                  as call_3bet_opp,
    sum(call_3bet_action)               as call_3bet_action,
    sum(fivebet_opp)                    as fivebet_opp,
    sum(fivebet_action)                 as fivebet_action,
    sum(fold_to_4bet_opp)               as fold_to_4bet_opp,
    sum(fold_to_4bet_action)            as fold_to_4bet_action,
    sum(vs_open_opp)                    as vs_open_opp,
    sum(vs_open_call)                   as vs_open_call,
    sum(vs_open_fold)                   as vs_open_fold,
    sum(vs_4bet_opp)                    as vs_4bet_opp,
    sum(vs_4bet_call)                   as vs_4bet_call,

    -- ---- postflop ---------------------------------------------------------------------
    sum(cbet_river_opp)                 as cbet_river_opp,
    sum(cbet_river_action)              as cbet_river_action,
    sum(fold_to_cbet_t_opp)             as fold_to_cbet_t_opp,
    sum(fold_to_cbet_t_action)          as fold_to_cbet_t_action,
    sum(fold_to_cbet_r_opp)             as fold_to_cbet_r_opp,
    sum(fold_to_cbet_r_action)          as fold_to_cbet_r_action,
    sum(donk_f_opp)                     as donk_f_opp,
    sum(donk_f_action)                  as donk_f_action,
    sum(probe_t_opp)                    as probe_t_opp,
    sum(probe_t_action)                 as probe_t_action,
    sum(delayed_cbet_opp)               as delayed_cbet_opp,
    sum(delayed_cbet_action)            as delayed_cbet_action,
    sum(float_opp)                      as float_opp,
    sum(float_action)                   as float_action,
    sum(checkraise_t_opp)               as checkraise_t_opp,
    sum(checkraise_t_action)            as checkraise_t_action,
    sum(checkraise_r_opp)               as checkraise_r_opp,
    sum(checkraise_r_action)            as checkraise_r_action,

    -- ---- leak counters (limp follow-through, c-bet responses, raises, probes, river) ---
    sum(limp_faced_raise_opp)           as limp_faced_raise_opp,
    sum(limp_fold_action)               as limp_fold_action,
    sum(limp_call_action)               as limp_call_action,
    sum(limp_raise_action)              as limp_raise_action,
    sum(raise_cbet_f_action)            as raise_cbet_f_action,
    sum(float_fold_opp)                 as float_fold_opp,
    sum(float_fold_action)              as float_fold_action,
    sum(fold_to_donk_opp)               as fold_to_donk_opp,
    sum(fold_to_donk_action)            as fold_to_donk_action,
    sum(fold_to_flop_raise_opp)         as fold_to_flop_raise_opp,
    sum(fold_to_flop_raise_action)      as fold_to_flop_raise_action,
    sum(fold_to_turn_raise_opp)         as fold_to_turn_raise_opp,
    sum(fold_to_turn_raise_action)      as fold_to_turn_raise_action,
    sum(fold_to_river_raise_opp)        as fold_to_river_raise_opp,
    sum(fold_to_river_raise_action)     as fold_to_river_raise_action,
    sum(bet_call_river_action)          as bet_call_river_action,
    sum(fold_to_probe_t_opp)            as fold_to_probe_t_opp,
    sum(fold_to_probe_t_action)         as fold_to_probe_t_action,
    sum(fold_to_delayed_cbet_opp)       as fold_to_delayed_cbet_opp,
    sum(fold_to_delayed_cbet_action)    as fold_to_delayed_cbet_action,
    sum(probe_r_opp)                    as probe_r_opp,
    sum(probe_r_action)                 as probe_r_action,
    sum(fold_to_probe_r_opp)            as fold_to_probe_r_opp,
    sum(fold_to_probe_r_action)         as fold_to_probe_r_action,
    sum(river_face_bet_opp)             as river_face_bet_opp,
    sum(river_raise_action)             as river_raise_action,
    sum(river_check_faced_opp)          as river_check_faced_opp,
    sum(river_check_fold_action)        as river_check_fold_action,
    sum(river_check_call_action)        as river_check_call_action,

    -- ---- raw aggression counts (AF / AFq inputs) --------------------------------------
    sum(aggr_f)                         as aggr_f,
    sum(aggr_t)                         as aggr_t,
    sum(aggr_r)                         as aggr_r,
    sum(call_f)                         as call_f,
    sum(call_t)                         as call_t,
    sum(call_r)                         as call_r,
    sum(fold_f)                         as fold_f,
    sum(fold_t)                         as fold_t,
    sum(fold_r)                         as fold_r,

    -- ---- street progression -----------------------------------------------------------
    sum(saw_flop)                       as saw_flop,
    sum(saw_turn)                       as saw_turn,
    sum(saw_river)                      as saw_river,
    sum(saw_river_opp)                  as saw_river_opp,
    sum(saw_river_action)               as saw_river_action,

    sum(net_won_bb)                     as net_won_bb,
    sum(ev_won_bb)                      as ev_won_bb,
    sum(showdown_won_bb)                as showdown_won_bb,
    sum(nonshowdown_won_bb)             as nonshowdown_won_bb,

    -- Watermark for the incremental gate. `max()` is the right reducer: a day is only as
    -- fresh as its most recently ingested hand, and any older hand in it is already counted.
    max(src_parsed_at)                  as src_parsed_at

from {{ ref('player_hand_flags') }}
where {{ dirty_partitions('played_at_utc') }}
group by
    user_id, dataset, player_key, day, site, stake_level, game_type,
    table_format, position, is_hero, is_anonymized
