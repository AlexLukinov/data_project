-- Board texture per hand, AT EACH STREET: what the board looked like when the flop, turn and
-- river decisions were made. A decision on the turn must see the turn card and not the river,
-- so every feature exists three times and marts/decisions.sql picks the one for its street.
--
-- Hands that never saw a flop have no row; the LEFT JOIN in the consumers zero-pads to '' / 0,
-- which is what the registry declares for "before the flop" (stats/registry/dimensions.yaml).
--
-- Ranks are 1..13 for 2..A via position() into one rank string, the same encoding as
-- macros/hand_arrays.sql uses for hole cards.

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, hand_uid)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

{% set ranks = '23456789TJQKA' %}

with flop as (

    select
        user_id,
        hand_uid,
        played_at_utc,
        src_parsed_at,
        [board_flop_1, board_flop_2, board_flop_3]                as f,
        board_turn                                                as c4,
        board_river                                               as c5
    from {{ ref('stg_hands') }}
    where board_flop_1 != '' and {{ dirty_partitions('played_at_utc') }}

),

parts as (

    select
        user_id,
        hand_uid,
        played_at_utc,
        src_parsed_at,
        arrayMap(c -> position('{{ ranks }}', substring(c, 1, 1)), f)   as fr,
        arrayMap(c -> substring(c, 2, 1), f)                             as fs,
        arrayReverseSort(fr)                                             as fr_desc,
        c4 != ''                                                         as has_turn,
        c5 != ''                                                         as has_river,
        position('{{ ranks }}', substring(c4, 1, 1))                     as r4,
        substring(c4, 2, 1)                                              as s4,
        position('{{ ranks }}', substring(c5, 1, 1))                     as r5,
        substring(c5, 2, 1)                                              as s5,
        if(has_turn, arrayConcat(fr, [r4]), fr)                          as tr,
        if(has_turn, arrayConcat(fs, [s4]), fs)                          as ts,
        if(has_river, arrayConcat(tr, [r5]), tr)                         as rr,
        if(has_river, arrayConcat(ts, [s5]), ts)                         as rs
    from flop

)

select
    user_id                                                              as user_id,
    hand_uid                                                             as hand_uid,
    played_at_utc                                                        as played_at_utc,
    src_parsed_at                                                        as src_parsed_at,

    -- ---- the flop ------------------------------------------------------------------
    multiIf(
        fs[1] = fs[2] and fs[2] = fs[3], 'monotone',
        fs[1] = fs[2] or fs[2] = fs[3] or fs[1] = fs[3], 'two_tone',
        'rainbow'
    )::LowCardinality(String)                                            as flop_suitedness,
    multiIf(
        fr[1] = fr[2] and fr[2] = fr[3], 'trips',
        fr[1] = fr[2] or fr[2] = fr[3] or fr[1] = fr[3], 'paired',
        'unpaired'
    )::LowCardinality(String)                                            as flop_pairing,
    substring('{{ ranks }}', fr_desc[1], 1)::LowCardinality(String)      as flop_high_card,
    toUInt8(fr_desc[1] - fr_desc[3])                                     as flop_span,
    multiIf(
        fr_desc[1] - fr_desc[3] <= 2, 'connected',
        fr_desc[1] - fr_desc[3] <= 4, 'semi_connected',
        'disconnected'
    )::LowCardinality(String)                                            as flop_connectedness,
    toUInt8(length(arrayDistinct(fr)) < length(fr))                      as paired_flop,
    {{ flush_possible('fs') }}                                           as flush_flop,
    {{ straight_possible('fr') }}                                        as straight_flop,

    -- ---- the turn ------------------------------------------------------------------
    if(has_turn, substring('{{ ranks }}', r4, 1), '')::LowCardinality(String) as turn_rank,
    toUInt8(has_turn and has(fr, r4))                                    as turn_pairs_board,
    toUInt8(has_turn and countEqual(ts, s4) >= 3)                        as turn_completes_flush,
    toUInt8(length(arrayDistinct(tr)) < length(tr))                      as paired_turn,
    {{ flush_possible('ts') }}                                           as flush_turn,
    {{ straight_possible('tr') }}                                        as straight_turn,

    -- ---- the river -----------------------------------------------------------------
    if(has_river, substring('{{ ranks }}', r5, 1), '')::LowCardinality(String) as river_rank,
    toUInt8(has_river and has(tr, r5))                                   as river_pairs_board,
    toUInt8(has_river and countEqual(rs, s5) >= 3 and countEqual(ts, s5) < 3) as river_completes_flush,
    toUInt8(length(arrayDistinct(rr)) < length(rr))                      as paired_river,
    {{ flush_possible('rs') }}                                           as flush_river,
    {{ straight_possible('rr') }}                                        as straight_river,

    -- ---- the board as dealt (hand-grain stats) ---------------------------------------
    toUInt8(length(arrayDistinct(rr)) < length(rr))                      as paired_final,
    {{ flush_possible('rs') }}                                           as flush_final
from parts
