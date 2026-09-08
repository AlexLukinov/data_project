-- Postflop context per (hand, seat, street): what each player did and what they faced.
--
-- Postflop stats are all shaped "did X happen, given the chance for X to happen":
--   c-bet flop        = the preflop aggressor bet, given they saw the flop
--   fold to c-bet     = folded, given they faced that bet
--   check-raise       = raised, given they checked and then faced a bet
-- The "given" half is the opportunity, and it is the half people get wrong.

with actions as (

    select * from {{ ref('stg_actions') }} where street in ('flop', 'turn', 'river')

),

per_seat_street as (

    select
        user_id,
        hand_uid,
        street,
        seat,
        min(action_index)                                       as first_idx,
        max(action_index)                                       as last_idx,
        max(action_type = 'bet')                                as did_bet,
        max(action_type = 'raise')                              as did_raise,
        max(action_type = 'check')                              as did_check,
        max(action_type = 'fold')                               as did_fold,
        max(action_type = 'call')                               as did_call,
        minIf(action_index, action_type = 'check')              as check_idx,
        minIf(action_index, action_type = 'raise')              as raise_idx
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
    s.street                                                            as street,
    s.seat                                                              as seat,
    s.did_bet                                                           as did_bet,
    s.did_raise                                                         as did_raise,
    s.did_check                                                         as did_check,
    s.did_fold                                                          as did_fold,
    s.did_call                                                          as did_call,
    s.check_idx                                                         as check_idx,
    s.raise_idx                                                         as raise_idx,
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
