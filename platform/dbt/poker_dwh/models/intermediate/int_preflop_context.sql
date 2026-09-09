-- Preflop context per (hand, seat): what each player was FACING when they first acted.
--
-- Nearly every preflop stat is a question about the sequence, not about the action:
--   3-bet%          = raised WHEN FACING EXACTLY ONE RAISE
--   fold to 3-bet   = folded AFTER OPENING and FACING A RE-RAISE
--   steal%          = raised WHEN FIRST IN from CO/BTN/SB
-- So this model computes, once, the facts those questions need. Computing them here rather
-- than in each stat is the difference between one join and twelve.
--
-- **"What happened before this player acted" is answered with per-hand ARRAYS.** Two earlier
-- shapes both died at 9M hands:
--
--   1. Joining each seat's first decision to every raise in the hand and counting the earlier
--      ones — quadratic in players x raises, 7GiB building the right-hand side.
--   2. A running `countIf(...) over (partition by hand order by action_index)` — correct and
--      linear, but ClickHouse must globally sort ~50M preflop actions to evaluate it, which
--      exceeded the query memory ceiling.
--
-- Collapsing each hand to a handful of small arrays of action indices does the same work in
-- one grouped pass: the aggregate output is one row per hand (9M), the arrays hold ~8 elements
-- each, and `arrayCount` answers "how many of these happened before index N" directly. The
-- expensive relation becomes the SMALL side of every join.

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, hand_uid, seat)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

with actions as (

    select * from {{ ref('stg_actions') }}
    where street = 'preflop' and {{ dirty_partitions('played_at_utc') }}

),

-- One row per hand carrying the action indices that matter, as arrays.
hand_arrays as (

    select
        user_id,
        hand_uid,
        max(played_at_utc)                                      as played_at_utc,
        max(src_parsed_at)                                      as src_parsed_at,
        groupArrayIf(action_index, action_type = 'raise')       as raise_idxs,
        groupArrayIf(action_index, is_voluntary)                as voluntary_idxs,
        groupArrayIf(action_index, action_type = 'call')        as call_idxs,
        countIf(action_type = 'raise')                          as n_raises,
        argMaxIf(seat, action_index, action_type = 'raise')     as aggressor_seat,
        argMinIf(seat, action_index, action_type = 'raise')     as opener_seat,
        -- The open size, needed to separate a 2.0x open from a 4x limp-raise. `amount_to` is
        -- the total the raiser made it, which is how open sizes are always quoted.
        argMinIf(amount_to, action_index, action_type = 'raise') as open_to,
        -- Sentinel, not 0: with no raise every call must count as a LIMP, so the comparison
        -- "did this call happen before the first raise" has to be true for all of them.
        toUInt32(if(countIf(action_type = 'raise') = 0, 4294967295,
                    minIf(action_index, action_type = 'raise'))) as first_raise_idx
    from actions
    group by user_id, hand_uid

),

-- Each seat's FIRST real decision preflop. Posts are not decisions.
first_decision as (

    select
        user_id,
        hand_uid,
        seat,
        max(played_at_utc)                             as played_at_utc,
        max(src_parsed_at)                             as src_parsed_at,
        min(action_index)                              as first_idx,
        argMin(action_type, action_index)              as first_action,
        max(action_type = 'raise')                     as did_raise,
        max(is_voluntary)                              as did_vpip,
        argMax(action_type, action_index)              as last_action
    from actions
    where is_decision
    group by user_id, hand_uid, seat

),

-- The opener's POSITION, resolved to one row per hand. Written with the per-hand summary on
-- the RIGHT of the join on purpose: ClickHouse builds the right side in memory, and
-- `hand_arrays` is 9M rows where `stg_hand_players` is 54M.
opener_position as (

    select
        p.user_id                                                   as user_id,
        p.hand_uid                                                  as hand_uid,
        p.position                                                  as opener_position
    from {{ ref('stg_hand_players') }} as p
    inner join hand_arrays as ha
        on ha.user_id = p.user_id and ha.hand_uid = p.hand_uid and ha.opener_seat = p.seat
    where {{ dirty_partitions('p.played_at_utc') }}

)

-- Alias EVERY column explicitly. ClickHouse keeps the table qualifier in the output column
-- name for any column that exists in more than one joined relation, so an unaliased
-- `f.user_id` produces a column literally named "f.user_id" -- which every downstream ref
-- then fails to resolve. Same trap as the lab's dbt/shop_dwh/models/marts/fct_orders.sql.
select
    f.user_id                                               as user_id,
    f.hand_uid                                              as hand_uid,
    f.played_at_utc                                         as played_at_utc,
    f.src_parsed_at                                         as src_parsed_at,
    f.seat                                                  as seat,
    -- A player who was dealt in but never got to act (a walked big blind) has no row here at
    -- all, and the LEFT JOIN in int_hand_player_flags would pad `n_voluntary_before` to 0 --
    -- indistinguishable from "acted first in". Consumers gate first-in opportunities on this.
    1                                                       as has_decision,
    f.first_idx                                             as first_idx,
    f.first_action                                          as first_action,
    f.last_action                                           as last_action,
    f.did_raise                                             as did_raise,
    f.did_vpip                                              as did_vpip,

    -- ---- "before this seat acted", straight off the arrays --------------------------
    toUInt8(arrayCount(x -> x < f.first_idx, ha.raise_idxs))        as raises_before,
    toUInt8(arrayCount(x -> x < f.first_idx, ha.voluntary_idxs))    as n_voluntary_before,
    -- A limp is a call made before ANY raise. A call after a raise is a cold call. Splitting
    -- on the first raise index is exact, and avoids guessing from bet sizes.
    toUInt8(arrayCount(
        x -> x < f.first_idx and x < ha.first_raise_idx, ha.call_idxs
    ))                                                              as n_limpers_before,
    toUInt8(arrayCount(
        x -> x < f.first_idx and x > ha.first_raise_idx, ha.call_idxs
    ))                                                              as n_cold_callers_before,

    coalesce(ha.opener_seat, 0)                             as first_raiser_seat,
    coalesce(op.opener_position, '')                        as first_raiser_position,
    coalesce(ha.n_raises, 0)                                as n_preflop_raises,
    ha.aggressor_seat                                       as aggressor_seat,
    ha.opener_seat                                          as opener_seat,
    coalesce(ha.open_to, toDecimal64(0, 4))                 as open_to,
    -- The preflop aggressor is the LAST raiser: the player expected to continuation-bet.
    cast(f.seat = ha.aggressor_seat as UInt8)               as is_preflop_aggressor,
    cast(f.seat = ha.opener_seat as UInt8)                  as is_preflop_opener
from first_decision as f
left join hand_arrays as ha
    on ha.user_id = f.user_id and ha.hand_uid = f.hand_uid
left join opener_position as op
    on op.user_id = f.user_id and op.hand_uid = f.hand_uid
