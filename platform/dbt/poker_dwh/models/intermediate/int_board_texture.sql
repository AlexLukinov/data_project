-- Board texture per hand: the dimension every postflop question is really asking about.
--
-- "How often do I c-bet?" is close to meaningless as a single number — the honest version is
-- "how often do I c-bet on a monotone board vs a rainbow one", and that requires texture to
-- exist as a *column* you can group by, not as a filter someone hand-writes each time.
--
-- Derived here once per hand rather than per (hand, player): the board is a property of the
-- hand, so computing it at player grain would do the work 6x over on a 55M-row table.
--
-- Cards are two-character strings, rank then suit: 'As', 'Th', '7d'. Rank order comes from
-- `position()` into a rank string, which yields 1..13 for 2..A — cheap, and it keeps the
-- ordering rules in one literal instead of a 13-branch CASE.

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
        board_flop_1 as c1,
        board_flop_2 as c2,
        board_flop_3 as c3,
        board_turn   as c4,
        board_river  as c5
    from {{ ref('stg_hands') }}
    where board_flop_1 != '' and {{ dirty_partitions('played_at_utc') }}

),

parts as (

    select
        user_id,
        hand_uid,
        played_at_utc,
        src_parsed_at,
        position('{{ ranks }}', substring(c1, 1, 1)) as r1,
        position('{{ ranks }}', substring(c2, 1, 1)) as r2,
        position('{{ ranks }}', substring(c3, 1, 1)) as r3,
        substring(c1, 2, 1) as s1,
        substring(c2, 2, 1) as s2,
        substring(c3, 2, 1) as s3,
        c4 != '' as has_turn,
        c5 != '' as has_river,
        -- Suit counts across the FULL board decide whether a flush is even possible by the
        -- river, which is what "wet board" means once all five cards are out.
        arrayFilter(x -> x != '', [substring(c1, 2, 1), substring(c2, 2, 1),
                                   substring(c3, 2, 1), substring(c4, 2, 1),
                                   substring(c5, 2, 1)]) as all_suits,
        arrayFilter(x -> x != '', [substring(c1, 1, 1), substring(c2, 1, 1),
                                   substring(c3, 1, 1), substring(c4, 1, 1),
                                   substring(c5, 1, 1)]) as all_ranks
    from flop

),

ordered as (

    select
        user_id,
        hand_uid,
        played_at_utc,
        src_parsed_at,
        r1, r2, r3, s1, s2, s3,
        has_turn,
        has_river,
        all_suits,
        all_ranks,
        arraySort(x -> -x, [r1, r2, r3]) as desc_ranks
    from parts

)

select
    user_id                                                          as user_id,
    hand_uid                                                         as hand_uid,
    played_at_utc                                                    as played_at_utc,
    src_parsed_at                                                    as src_parsed_at,

    -- ---- suitedness -----------------------------------------------------------------
    multiIf(
        s1 = s2 and s2 = s3, 'monotone',
        s1 = s2 or s2 = s3 or s1 = s3, 'two_tone',
        'rainbow'
    )                                                                as flop_suitedness,

    -- ---- pairing --------------------------------------------------------------------
    multiIf(
        r1 = r2 and r2 = r3, 'trips',
        r1 = r2 or r2 = r3 or r1 = r3, 'paired',
        'unpaired'
    )                                                                as flop_pairing,

    -- ---- height ---------------------------------------------------------------------
    -- The highest flop card drives range advantage more than any other single feature, so it
    -- gets its own dimension rather than being buried in a composite texture string.
    substring('{{ ranks }}', desc_ranks[1], 1)                       as flop_high_card,
    cast(desc_ranks[1] >= 12 as UInt8)                               as flop_has_ace_or_king,
    cast(desc_ranks[3] >= 8 as UInt8)                                as flop_all_broadway,

    -- ---- connectedness --------------------------------------------------------------
    -- Span of the three ranks. <= 4 means a straight can use all three cards.
    toUInt8(desc_ranks[1] - desc_ranks[3])                           as flop_span,
    multiIf(
        desc_ranks[1] - desc_ranks[3] <= 2, 'connected',
        desc_ranks[1] - desc_ranks[3] <= 4, 'semi_connected',
        'disconnected'
    )                                                                as flop_connectedness,

    -- ---- full-board features --------------------------------------------------------
    cast(length(arrayDistinct(all_ranks)) < length(all_ranks) as UInt8) as board_paired_final,
    -- A flush is possible once any suit appears three times across the dealt board.
    cast(arrayMax(arrayMap(s -> countEqual(all_suits, s), all_suits)) >= 3 as UInt8)
                                                                     as board_flush_possible,
    toUInt8(length(all_ranks))                                       as board_cards_dealt
from ordered
