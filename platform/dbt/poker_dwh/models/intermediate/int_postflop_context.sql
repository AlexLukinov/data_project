-- Postflop context per (hand, seat, street): what each player did and what they faced.
--
-- Postflop stats are all shaped "did X happen, given the chance for X to happen":
--   c-bet flop        = the preflop aggressor bet, given they saw the flop
--   fold to c-bet     = folded, given they faced that bet
--   check-raise       = raised, given they checked and then faced a bet
-- The "given" half is the opportunity, and it is the half people get wrong.

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, hand_uid, seat, street)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

with actions as (

    select * from {{ ref('stg_actions') }}
    where street in ('flop', 'turn', 'river') and {{ dirty_partitions('played_at_utc') }}

),

per_seat_street as (

    select
        user_id,
        hand_uid,
        street,
        seat,
        max(played_at_utc)                                      as played_at_utc,
        max(src_parsed_at)                                      as src_parsed_at,
        min(action_index)                                       as first_idx,
        max(action_index)                                       as last_idx,
        max(action_type = 'bet')                                as did_bet,
        max(action_type = 'raise')                              as did_raise,
        max(action_type = 'check')                              as did_check,
        max(action_type = 'fold')                               as did_fold,
        max(action_type = 'call')                               as did_call,
        minIf(action_index, action_type = 'check')              as check_idx,
        minIf(action_index, action_type = 'raise')              as raise_idx,
        max(action_type = 'call')                               as did_call_street,
        -- ---- bet sizing ---------------------------------------------------------------
        -- Size as a fraction of the pot BEFORE the bet, which is how every solver, every
        -- coach and every player states it. Stored as the raw ratio so the bucket boundaries
        -- stay a presentation choice rather than something baked into the fact table.
        argMinIf(
            amount / nullIf(pot_before, 0), action_index, action_type in ('bet', 'raise')
        )                                                       as bet_size_pct,
        -- What the player was ASKED to pay, as a fraction of the pot. The denominator of every
        -- "fold to a big bet vs a small bet" question.
        argMinIf(
            to_call / nullIf(pot_before, 0), action_index, to_call > 0
        )                                                       as faced_size_pct
    from actions
    group by user_id, hand_uid, street, seat

),

-- The first aggressive action on each street, and who made it.
street_level as (

    select
        user_id,
        hand_uid,
        street,
        minIf(action_index, action_type in ('bet', 'raise'))                as first_bet_idx,
        argMinIf(seat, action_index, action_type in ('bet', 'raise'))       as first_bettor_seat,
        countIf(action_type in ('bet', 'raise'))                            as n_aggressive
    from actions
    group by user_id, hand_uid, street

)

-- Alias every column explicitly -- see the note in int_preflop_context.sql.
select
    s.user_id                                                           as user_id,
    s.hand_uid                                                          as hand_uid,
    s.played_at_utc                                                     as played_at_utc,
    s.src_parsed_at                                                     as src_parsed_at,
    s.street                                                            as street,
    s.seat                                                              as seat,
    s.did_bet                                                           as did_bet,
    s.did_raise                                                         as did_raise,
    s.did_check                                                         as did_check,
    s.did_fold                                                          as did_fold,
    s.did_call                                                          as did_call,
    s.check_idx                                                         as check_idx,
    s.raise_idx                                                         as raise_idx,
    s.did_call_street                                                   as did_call_street,
    s.bet_size_pct                                                      as bet_size_pct,
    s.faced_size_pct                                                    as faced_size_pct,
    -- Buckets named after how players actually talk about sizes: a third, half, two-thirds,
    -- pot, overbet. Anything finer produces cells too small to read.
    multiIf(
        isNull(s.bet_size_pct), 'none',
        s.bet_size_pct <= 0.37, 'small',
        s.bet_size_pct <= 0.60, 'mid',
        s.bet_size_pct <= 0.85, 'large',
        s.bet_size_pct <= 1.10, 'pot',
        'overbet'
    )::LowCardinality(String)                                           as bet_size_bucket,
    multiIf(
        isNull(s.faced_size_pct), 'none',
        s.faced_size_pct <= 0.37, 'small',
        s.faced_size_pct <= 0.60, 'mid',
        s.faced_size_pct <= 0.85, 'large',
        s.faced_size_pct <= 1.10, 'pot',
        'overbet'
    )::LowCardinality(String)                                           as faced_size_bucket,
    l.first_bet_idx                                                     as first_bet_idx,
    l.first_bettor_seat                                                 as first_bettor_seat,
    l.n_aggressive                                                      as n_aggressive,
    -- Faced a bet at all on this street.
    cast(l.n_aggressive > 0 and l.first_bettor_seat != s.seat as UInt8)
        as faced_aggression,
    -- Checked, and then someone bet behind: the check-raise opportunity.
    cast(s.did_check = 1 and l.n_aggressive > 0 and l.first_bet_idx > s.check_idx as UInt8)
        as had_checkraise_chance
from per_seat_street as s
left join street_level as l
    on l.user_id = s.user_id and l.hand_uid = s.hand_uid and l.street = s.street
