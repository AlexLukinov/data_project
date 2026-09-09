-- One row per (hand, player): the hand-grain fact behind VPIP, PFR, WTSD, WWSF, W$SD and
-- bb/100 (ADR-020). ~35 columns, not 156: everything "facing X, did Y" lives on decisions.
--
-- Built by exploding the seat arrays of hand_arrays() (macros/hand_arrays.sql), so the only
-- join is at hand grain (the per-street board). Columns are the `player_hands` entries of
-- stats/registry/dimensions.yaml.

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, dataset, player_key_norm, played_date, hand_uid, seat)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

select
    hb.user_id                                                   as user_id,
    hb.dataset                                                   as dataset,
    hb.hand_uid                                                  as hand_uid,
    hb.played_at_utc                                             as played_at_utc,
    hb.played_date                                               as played_date,
    seat                                                         as seat,
    player_key                                                   as player_key,
    player_key_norm                                              as player_key_norm,
    is_hero                                                      as is_hero,
    is_anonymized                                                as is_anonymized,

    -- ---- table dimensions -----------------------------------------------------------
    hb.site                                                      as site,
    hb.stake_level                                               as stake_level,
    hb.game_type                                                 as game_type,
    hb.table_format                                              as table_format,
    hb.big_blind                                                 as big_blind,
    hb.players_dealt_in                                          as players_dealt_in,
    position::LowCardinality(String)                             as position,
    hb.pot_type                                                  as pot_type,
    hb.players_to_flop                                           as players_to_flop,

    -- ---- holding, depth, position ---------------------------------------------------
    hand_class::LowCardinality(String)                           as hand_class,
    hand_shape::LowCardinality(String)                           as hand_shape,
    hole_cards                                                   as hole_cards,
    stack_bb                                                     as stack_bb,
    toUInt8(saw_flop = 1 and hb.flop_last_seat = seat)           as is_ip,

    -- ---- the board (zero-padded to '' / 0 when no flop was dealt) --------------------
    hb.b_flop_suitedness::LowCardinality(String)                 as flop_suitedness,
    hb.b_flop_pairing::LowCardinality(String)                    as flop_pairing,
    hb.b_flop_high_card::LowCardinality(String)                  as flop_high_card,
    hb.b_flop_connectedness::LowCardinality(String)              as flop_connectedness,
    hb.b_flop_span                                               as flop_span,
    hb.b_paired_final                                            as board_paired_final,
    hb.b_flush_final                                             as board_flush_possible_final,

    -- ---- what happened --------------------------------------------------------------
    did_vpip                                                     as did_vpip,
    did_pfr                                                      as did_pfr,
    saw_flop                                                     as saw_flop,
    saw_turn                                                     as saw_turn,
    saw_river                                                    as saw_river,
    went_to_showdown                                             as went_to_showdown,
    won_hand                                                     as won_hand,
    net_won_bb                                                   as net_won_bb,
    ev_won_bb                                                    as ev_won_bb,
    if(went_to_showdown = 1, net_won_bb, toDecimal64(0, 4))      as showdown_won_bb,
    if(went_to_showdown = 1, toDecimal64(0, 4), net_won_bb)      as nonshowdown_won_bb,
    rake_paid_bb                                                 as rake_paid_bb,

    hb.parser_version                                            as parser_version,
    hb.src_parsed_at                                             as src_parsed_at
from (
    select
        h.*,
        b.flop_suitedness     as b_flop_suitedness,
        b.flop_pairing        as b_flop_pairing,
        b.flop_high_card      as b_flop_high_card,
        b.flop_connectedness  as b_flop_connectedness,
        b.flop_span           as b_flop_span,
        b.paired_final        as b_paired_final,
        b.flush_final         as b_flush_final
    from ({{ hand_arrays() }}) as h
    left join {{ ref('int_board_by_street') }} as b
        on b.user_id = h.user_id and b.hand_uid = h.hand_uid
       and {{ dirty_partitions('b.played_at_utc') }}
    where {{ dirty_partitions('h.played_at_utc') }}
) as hb
array join
    hb.s_seat             as seat,
    hb.s_position         as position,
    hb.s_player_key       as player_key,
    hb.s_player_key_norm  as player_key_norm,
    hb.s_is_hero          as is_hero,
    hb.s_is_anonymized    as is_anonymized,
    hb.s_stack_bb         as stack_bb,
    hb.s_hole_cards       as hole_cards,
    hb.s_hand_class       as hand_class,
    hb.s_hand_shape       as hand_shape,
    hb.s_net_won_bb       as net_won_bb,
    hb.s_ev_won_bb        as ev_won_bb,
    hb.s_saw_flop         as saw_flop,
    hb.s_saw_turn         as saw_turn,
    hb.s_saw_river        as saw_river,
    hb.s_went_to_showdown as went_to_showdown,
    hb.s_won_hand         as won_hand,
    hb.s_rake_paid_bb     as rake_paid_bb,
    hb.s_did_vpip         as did_vpip,
    hb.s_did_pfr          as did_pfr
