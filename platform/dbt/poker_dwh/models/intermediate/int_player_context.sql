-- Per (hand, seat) context: starting holding, stack depth, SPR, and postflop position.
--
-- These are the dimensions that turn a flat stat into an answerable question. "I c-bet 62%"
-- is trivia; "I c-bet 78% at SPR under 3 and 41% at SPR over 13, in position" is a leak
-- report. All four are derivable from data already parsed — they were simply never projected
-- into a column anything could group by.
--
-- **`hand_class` is populated only where hole cards are known**: always for hero, and for
-- opponents only at showdown (~13% of observed pool hands). It is deliberately '' rather than
-- NULL elsewhere, because '' groups cleanly and a NULL in a GROUP BY key invites the same
-- nullable-sorting-key problem documented in marts/player_hand_flags.sql.
--
-- MEMORY NOTE: this model runs at 54M rows and ClickHouse builds the RIGHT side of a join in
-- memory. Two consequences shape the SQL below:
--   1. The holding is parsed INLINE from `p.hole_cards` rather than joined from a derived
--      relation — the column is already on the row, so a join for it was pure waste.
--   2. The per-seat action aggregates are computed as ONE relation, not three, so there is a
--      single large right-hand side instead of several.
-- What remains is bounded by the server-side `join_algorithm` fallback chain in
-- infra/clickhouse/limits.xml, which drops to grace_hash/partial_merge rather than hashing the
-- whole right side into RAM — the default algorithm died here at 9M hands.

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, hand_uid, seat)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

{% set ranks = '23456789TJQKA' %}

-- One pass over the action stream, producing every per-seat fact this model needs.
with seat_actions as (

    select
        user_id,
        hand_uid,
        seat,
        sumIf(amount, street = 'preflop')                   as invested_preflop,
        minIf(action_index, street = 'flop')                as first_flop_idx,
        countIf(street = 'flop')                            as n_flop_actions
    from {{ ref('stg_actions') }}
    where {{ dirty_partitions('played_at_utc') }}
    group by user_id, hand_uid, seat

),

-- Postflop acting order. "In position" is decided by who acts LAST on the flop among the
-- players still live, which the action stream states directly -- no need to re-derive it from
-- seat numbers and the button, which goes wrong in every short-handed edge case.
flop_last as (

    select
        user_id,
        hand_uid,
        max(first_flop_idx) as last_actor_idx,
        countIf(n_flop_actions > 0) as n_flop_actors
    from seat_actions
    where n_flop_actions > 0
    group by user_id, hand_uid

)

select
    p.user_id                                                        as user_id,
    p.hand_uid                                                       as hand_uid,
    p.played_at_utc                                                  as played_at_utc,
    p.src_parsed_at                                                  as src_parsed_at,
    p.seat                                                           as seat,

    -- ---- holding, parsed inline ------------------------------------------------------
    -- 'AKs' / 'AKo' / 'TT' -- the standard 169-combo vocabulary every solver and range tool
    -- already speaks, so ranges paste straight in and out. Hold'em-shaped hands only; Omaha
    -- classes need their own vocabulary and get '' here rather than a wrong answer.
    multiIf(
        length(splitByChar(' ', p.hole_cards)) != 2, '',
        position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[1], 1, 1))
            = position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[2], 1, 1)),
        concat(
            substring(splitByChar(' ', p.hole_cards)[1], 1, 1),
            substring(splitByChar(' ', p.hole_cards)[1], 1, 1)
        ),
        concat(
            substring('{{ ranks }}', greatest(
                position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[1], 1, 1)),
                position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[2], 1, 1))), 1),
            substring('{{ ranks }}', least(
                position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[1], 1, 1)),
                position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[2], 1, 1))), 1),
            if(
                substring(splitByChar(' ', p.hole_cards)[1], 2, 1)
                    = substring(splitByChar(' ', p.hole_cards)[2], 2, 1),
                's', 'o'
            )
        )
    )                                                                as hand_class,

    multiIf(
        length(splitByChar(' ', p.hole_cards)) != 2, '',
        position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[1], 1, 1))
            = position('{{ ranks }}', substring(splitByChar(' ', p.hole_cards)[2], 1, 1)), 'pair',
        substring(splitByChar(' ', p.hole_cards)[1], 2, 1)
            = substring(splitByChar(' ', p.hole_cards)[2], 2, 1), 'suited',
        'offsuit'
    )                                                                as hand_shape,

    -- ---- depth -----------------------------------------------------------------------
    coalesce(sa.invested_preflop, toDecimal64(0, 4))                 as invested_preflop,
    -- Stack behind at the flop, in big blinds: the depth the postflop decision was actually
    -- played at, which is not the same as the stack the player sat down with.
    toDecimal64(
        (p.starting_stack - coalesce(sa.invested_preflop, toDecimal64(0, 4))) / h.big_blind, 2
    )                                                                as stack_at_flop_bb,

    -- SPR: stack behind divided by the pot at the flop. The single best predictor of whether
    -- a postflop stack-off is correct, and the reason a "c-bet %" without it is a blur.
    if(
        hx.pot_at_flop > 0,
        toDecimal64(
            (p.starting_stack - coalesce(sa.invested_preflop, toDecimal64(0, 4)))
            / hx.pot_at_flop, 2
        ),
        toDecimal64(0, 2)
    )                                                                as spr,
    multiIf(
        hx.pot_at_flop <= 0, 'na',
        (p.starting_stack - coalesce(sa.invested_preflop, toDecimal64(0, 4)))
            / hx.pot_at_flop < 1, '0-1',
        (p.starting_stack - coalesce(sa.invested_preflop, toDecimal64(0, 4)))
            / hx.pot_at_flop < 3, '1-3',
        (p.starting_stack - coalesce(sa.invested_preflop, toDecimal64(0, 4)))
            / hx.pot_at_flop < 6, '3-6',
        (p.starting_stack - coalesce(sa.invested_preflop, toDecimal64(0, 4)))
            / hx.pot_at_flop < 13, '6-13',
        '13+'
    )                                                                as spr_bucket,

    multiIf(
        p.starting_stack_bb < 40, '0-40',
        p.starting_stack_bb < 75, '40-75',
        p.starting_stack_bb < 125, '75-125',
        p.starting_stack_bb < 200, '125-200',
        '200+'
    )                                                                as stack_bucket,

    -- ---- position --------------------------------------------------------------------
    cast(
        coalesce(sa.n_flop_actions, 0) > 0
        and sa.first_flop_idx = fl.last_actor_idx as UInt8
    )                                                                as is_ip,
    coalesce(toUInt8(fl.n_flop_actors), toUInt8(0))                  as n_flop_actors
-- The dirty-partition gate is repeated on EVERY relation, not just the driving one.
-- ClickHouse does not push a predicate on `p` through a join into `h` or `hx`, and the
-- unfiltered right-hand side is precisely what has to be built in memory -- which is the
-- entire reason this chain needed a 15 GB server.
from {{ ref('stg_hand_players') }} as p
inner join {{ ref('stg_hands') }} as h
    on h.user_id = p.user_id and h.hand_uid = p.hand_uid
   and {{ dirty_partitions('h.played_at_utc') }}
left join {{ ref('int_hand_context') }} as hx
    on hx.user_id = p.user_id and hx.hand_uid = p.hand_uid
   and {{ dirty_partitions('hx.played_at_utc') }}
left join flop_last as fl
    on fl.user_id = p.user_id and fl.hand_uid = p.hand_uid
left join seat_actions as sa
    on sa.user_id = p.user_id and sa.hand_uid = p.hand_uid and sa.seat = p.seat
where {{ dirty_partitions('p.played_at_utc') }}
