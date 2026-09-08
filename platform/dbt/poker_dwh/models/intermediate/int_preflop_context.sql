-- Preflop context per (hand, seat): what each player was FACING when they first acted.
--
-- Nearly every preflop stat is a question about the sequence, not about the action:
--   3-bet%          = raised WHEN FACING EXACTLY ONE RAISE
--   fold to 3-bet   = folded AFTER OPENING and FACING A RE-RAISE
--   steal%          = raised WHEN FIRST IN from CO/BTN/SB
-- So this model computes, once, the facts those questions need. Computing them here rather
-- than in each stat is the difference between one join and twelve.

with actions as (

    select * from {{ ref('stg_actions') }} where street = 'preflop'

),

-- Every preflop raise, numbered. raise_no = 1 is the opener, 2 is the 3-bettor, 3 the
-- 4-bettor. (Poker counts the big blind as the first "bet", hence the off-by-one in the
-- names — a 3-bet is the second raise.)
raises as (

    select
        user_id,
        hand_uid,
        seat,
        action_index,
        row_number() over (partition by user_id, hand_uid order by action_index) as raise_no
    from actions
    where action_type = 'raise'

),

-- Each seat's FIRST real decision preflop (posts don't count as decisions).
first_decision as (

    select
        user_id,
        hand_uid,
        seat,
        min(action_index)                        as first_idx,
        argMin(action_type, action_index)        as first_action,
        max(action_type = 'raise')               as did_raise,
        max(is_voluntary)                        as did_vpip,
        argMax(action_type, action_index)        as last_action
    from actions
    where is_decision
    group by user_id, hand_uid, seat

),

-- Hand-level preflop summary.
hand_level as (

    select
        user_id,
        hand_uid,
        count()                                            as n_raises,
        argMax(seat, raise_no)                             as aggressor_seat,
        argMinIf(seat, raise_no, raise_no = 1)             as opener_seat
    from raises
    group by user_id, hand_uid

),

-- How many raises, and how much voluntary money, went in BEFORE each seat first acted.
facing as (

    select
        d.user_id,
        d.hand_uid,
        d.seat,
        d.first_idx,
        d.first_action,
        d.last_action,
        d.did_raise,
        d.did_vpip,
        countIf(r.action_index < d.first_idx)              as raises_before,
        -- Which seat made the raise this player is facing (needed for steal detection).
        argMinIf(r.seat, r.raise_no, r.raise_no = 1)       as first_raiser_seat
    from first_decision as d
    left join raises as r
        on r.user_id = d.user_id and r.hand_uid = d.hand_uid
    group by d.user_id, d.hand_uid, d.seat, d.first_idx, d.first_action,
             d.last_action, d.did_raise, d.did_vpip

),

-- Was anyone in voluntarily before this seat acted? "First in" is the steal precondition.
prior_voluntary as (

    select
        d.user_id,
        d.hand_uid,
        d.seat,
        countIf(a.is_voluntary and a.action_index < d.first_idx) as n_voluntary_before
    from first_decision as d
    left join actions as a
        on a.user_id = d.user_id and a.hand_uid = d.hand_uid
    group by d.user_id, d.hand_uid, d.seat

),

-- Seat -> position, so the first raiser's POSITION can be resolved here rather than through a
-- chained join downstream (ClickHouse cannot key one JOIN off a table joined earlier in the
-- same statement).
seat_positions as (

    select user_id, hand_uid, seat, position from {{ ref('stg_hand_players') }}

)

-- Alias EVERY column explicitly. ClickHouse keeps the table qualifier in the output column
-- name for any column that exists in more than one joined relation, so an unaliased
-- `f.user_id` produces a column literally named "f.user_id" -- which every downstream ref
-- then fails to resolve. Same trap as the lab's dbt/shop_dwh/models/marts/fct_orders.sql.
select
    f.user_id                                               as user_id,
    f.hand_uid                                              as hand_uid,
    f.seat                                                  as seat,
    f.first_idx                                             as first_idx,
    f.first_action                                          as first_action,
    f.last_action                                           as last_action,
    f.did_raise                                             as did_raise,
    f.did_vpip                                              as did_vpip,
    f.raises_before                                         as raises_before,
    f.first_raiser_seat                                     as first_raiser_seat,
    coalesce(sp.position, '')                               as first_raiser_position,
    coalesce(pv.n_voluntary_before, 0)                      as n_voluntary_before,
    coalesce(hl.n_raises, 0)                                as n_preflop_raises,
    hl.aggressor_seat                                       as aggressor_seat,
    hl.opener_seat                                          as opener_seat,
    -- The preflop aggressor is the LAST raiser: the player expected to continuation-bet.
    cast(f.seat = hl.aggressor_seat as UInt8)               as is_preflop_aggressor,
    cast(f.seat = hl.opener_seat as UInt8)                  as is_preflop_opener
from facing as f
left join prior_voluntary as pv
    on pv.user_id = f.user_id and pv.hand_uid = f.hand_uid and pv.seat = f.seat
left join hand_level as hl
    on hl.user_id = f.user_id and hl.hand_uid = f.hand_uid
left join seat_positions as sp
    on sp.user_id = f.user_id and sp.hand_uid = f.hand_uid and sp.seat = f.first_raiser_seat
