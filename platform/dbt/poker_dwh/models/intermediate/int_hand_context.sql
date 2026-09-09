-- Hand-level context: pot type, how many players saw the flop, and the pot size at the flop.
--
-- `pot_type` is the single most important postflop dimension after position. A c-bet in a
-- single-raised pot and a c-bet in a 4-bet pot are different actions with different correct
-- frequencies, and averaging them produces a number describing neither. Every serious tracker
-- slices on it; this is where it comes from.
--
-- `pot_at_flop` exists to make SPR computable downstream. It is read off the first flop
-- action's `pot_before` rather than re-summed from contributions: the parser already
-- reconciled that number against the hand's own Total-pot line, so trusting it here keeps one
-- source of truth for pot math instead of a second, subtly different one.

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, hand_uid)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

with preflop_raises as (

    select
        user_id,
        hand_uid,
        countIf(action_type = 'raise')                              as n_raises,
        countIf(is_voluntary and action_type = 'call')              as n_calls,
        countIf(action_type = 'call' and to_call <= amount and pot_before > 0) as n_limp_calls
    from {{ ref('stg_actions') }}
    where street = 'preflop' and {{ dirty_partitions('played_at_utc') }}
    group by user_id, hand_uid

),

flop_start as (

    select
        user_id,
        hand_uid,
        argMin(pot_before, action_index)                            as pot_at_flop,
        min(action_index)                                           as first_flop_idx
    from {{ ref('stg_actions') }}
    where street = 'flop' and {{ dirty_partitions('played_at_utc') }}
    group by user_id, hand_uid

),

seen as (

    -- Table alias + qualified columns are load-bearing here, not style. ClickHouse makes
    -- SELECT aliases visible to WHERE, so an unqualified `played_at_utc` in the WHERE binds to
    -- the OUTPUT alias `max(played_at_utc)` rather than to the source column, and the query
    -- dies with "Aggregate function found in WHERE" (ILLEGAL_AGGREGATION). Qualifying as
    -- `p.played_at_utc` forces it back to the column.
    select
        p.user_id                                                   as user_id,
        p.hand_uid                                                  as hand_uid,
        max(p.played_at_utc)                                        as played_at_utc,
        max(p.src_parsed_at)                                        as src_parsed_at,
        -- UInt8, not the UInt64 countIf() would infer: a table seats at most 10, so the
        -- narrow type is the honest one (and the one the API binds filters against).
        toUInt8(countIf(p.saw_flop = 1))                            as players_to_flop,
        toUInt8(countIf(p.saw_turn = 1))                            as players_to_turn,
        toUInt8(countIf(p.saw_river = 1))                           as players_to_river,
        toUInt8(countIf(p.went_to_showdown = 1))                    as players_to_showdown
    from {{ ref('stg_hand_players') }} as p
    where {{ dirty_partitions('p.played_at_utc') }}
    group by p.user_id, p.hand_uid

)

select
    s.user_id                                                       as user_id,
    s.hand_uid                                                      as hand_uid,
    s.played_at_utc                                                 as played_at_utc,
    s.src_parsed_at                                                 as src_parsed_at,
    coalesce(r.n_raises, 0)                                         as n_preflop_raises,
    coalesce(r.n_calls, 0)                                          as n_preflop_calls,
    -- Poker's off-by-one: the big blind counts as the first bet, so the FIRST raise opens the
    -- pot ("single raised") and the SECOND raise is the 3-bet.
    -- LowCardinality: five distinct values ever, so GROUP BY and IN-filters work on a small
    -- dictionary. (Measured: it does NOT shrink the table -- LZ4 already compresses such
    -- repetitive strings to ~0.4 bytes/row; the type is about query cost, not disk.)
    multiIf(
        coalesce(r.n_raises, 0) = 0, 'limped',
        r.n_raises = 1, 'srp',
        r.n_raises = 2, '3bet',
        r.n_raises = 3, '4bet',
        '5bet_plus'
    )::LowCardinality(String)                                       as pot_type,
    cast(coalesce(r.n_raises, 0) = 0 and coalesce(r.n_calls, 0) > 0 as UInt8)
                                                                    as is_limped_pot,
    s.players_to_flop                                               as players_to_flop,
    s.players_to_turn                                               as players_to_turn,
    s.players_to_river                                              as players_to_river,
    s.players_to_showdown                                           as players_to_showdown,
    cast(s.players_to_flop > 2 as UInt8)                            as is_multiway,
    coalesce(f.pot_at_flop, toDecimal64(0, 4))                      as pot_at_flop,
    coalesce(f.first_flop_idx, 0)                                   as first_flop_idx
from seen as s
left join preflop_raises as r
    on r.user_id = s.user_id and r.hand_uid = s.hand_uid
left join flop_start as f
    on f.user_id = s.user_id and f.hand_uid = s.hand_uid
