{#
  One row per hand, carrying the whole hand as ARRAYS: every action in order, and every seat.

  This is the relation marts/decisions.sql (through decision_state()) explodes with ARRAY JOIN,
  and the one marts/player_hands.sql explodes by seat. Everything "before this decision" is
  then an array function over a prefix of these arrays -- no join ever happens at decision
  grain, and the right side of every join stays at hand grain (9M rows, ~150k per daily
  partition). POKER_PLAN.md §2.3, ADR-020.

  A macro, not a model, for the same reason as decision_state(): rendered inside each consumer,
  the dirty-partition gate is that consumer's own, and nothing is persisted that no query
  reads after the pass (as a table it held 2.39 GiB the API never touched -- plan C.6).
  The arrays are computed once per consumer per pass; both consumers rebuild the same
  partitions, so that is two hand-grain aggregations per day of new data, not a rebuild.

  Encoding:
    a_st    street as UInt8: 0 preflop, 1 flop, 2 turn, 3 river
    a_tok   one letter per action: p post · f fold · x check · l limp · c call · b bet · r raise
            ('l' is a preflop call with no raise in front -- the only place the distinction
            between a limp and a cold call is cheap to make, so it is made here once)
    a_amt / a_to / a_pot / a_call   chips put in, raised-to, pot before, to call -- in BIG BLINDS
  Seat arrays (s_*) are sorted by seat and aligned; `indexOf(s_seat, seat)` finds a player.

  `hand_uid` becomes FixedString(16) here and in everything downstream (plan B.5b): the hex
  string was 51% of the v1 fact table. `lower(hex(hand_uid))` gives the core.* form back.
#}

{% macro hand_arrays() %}
{%- set ranks = '23456789TJQKA' -%}
with acts as (

    select
        user_id,
        hand_uid,
        action_index,
        seat,
        multiIf(street = 'preflop', 0, street = 'flop', 1, street = 'turn', 2, 3)::UInt8 as st,
        action_type,
        amount,
        amount_to,
        pot_before,
        to_call,
        is_allin,
        is_voluntary
    from {{ ref('stg_actions') }}
    where action_type in ('post_sb', 'post_bb', 'post_ante', 'post_straddle', 'post_dead',
                          'fold', 'check', 'call', 'bet', 'raise')
      and {{ dirty_partitions('played_at_utc') }}

),

hand_actions as (

    select
        user_id,
        hand_uid,
        arraySort(t -> t.1, groupArray((action_index, seat, st, action_type, amount, amount_to,
                                        pot_before, to_call, is_allin, is_voluntary))) as acts,
        -- Sentinel, not 0: with no raise every preflop call must count as a limp.
        if(countIf(st = 0 and action_type = 'raise') = 0, toUInt16(65535),
           minIf(action_index, st = 0 and action_type = 'raise'))            as first_raise_idx,
        toUInt8(countIf(st = 0 and action_type = 'raise'))                   as n_preflop_raises,
        argMinIf(seat, action_index, st = 0 and action_type = 'raise')       as opener_seat,
        argMaxIf(seat, action_index, st = 0 and action_type = 'raise')       as aggressor_seat,
        argMinIf(pot_before, action_index, st = 1)                           as pot_at_flop
    from acts
    group by user_id, hand_uid

),

seats_raw as (

    select
        user_id,
        hand_uid,
        seat,
        toString(position)                                       as position,
        player_key,
        coalesce(player_key, '')                                 as player_key_norm,
        is_hero,
        is_anonymized,
        toFloat32(starting_stack_bb)                             as stack_bb,
        hole_cards,
        net_won_bb,
        coalesce(ev_won_bb, net_won_bb)                          as ev_won_bb,
        saw_flop,
        saw_turn,
        saw_river,
        went_to_showdown,
        won_hand,
        total_invested,
        -- Written at parse time by core/classify.py; '' where the cards or the board were not
        -- known. SQL cannot rank a poker hand, which is why these are columns and not an
        -- expression here (plan E.5, ADR-018).
        made_hand_flop,
        made_hand_turn,
        made_hand_river,
        -- 'AKs' / 'T9o' / 'QQ' -- the 169-combo vocabulary. Hold'em-shaped hands only.
        splitByChar(' ', hole_cards)                             as cards,
        if(length(cards) = 2, position('{{ ranks }}', substring(cards[1], 1, 1)), 0) as r1,
        if(length(cards) = 2, position('{{ ranks }}', substring(cards[2], 1, 1)), 0) as r2,
        length(cards) = 2 and substring(cards[1], 2, 1) = substring(cards[2], 2, 1) as suited,
        multiIf(
            r1 = 0 or r2 = 0, '',
            r1 = r2, concat(substring('{{ ranks }}', r1, 1), substring('{{ ranks }}', r1, 1)),
            concat(substring('{{ ranks }}', greatest(r1, r2), 1),
                   substring('{{ ranks }}', least(r1, r2), 1),
                   if(suited, 's', 'o'))
        )                                                        as hand_class,
        multiIf(r1 = 0 or r2 = 0, '', r1 = r2, 'pair', suited, 'suited', 'offsuit') as hand_shape
    from {{ ref('stg_hand_players') }}
    where {{ dirty_partitions('played_at_utc') }}

),

seats as (

    select
        user_id,
        hand_uid,
        arraySort(t -> t.1, groupArray((seat, position, player_key, player_key_norm, is_hero,
                                        is_anonymized, stack_bb, hole_cards, hand_class,
                                        hand_shape, net_won_bb, ev_won_bb, saw_flop, saw_turn,
                                        saw_river, went_to_showdown, won_hand,
                                        total_invested, made_hand_flop, made_hand_turn,
                                        made_hand_river)))                 as seats,
        sum(total_invested)                                                as invested_total
    from seats_raw
    group by user_id, hand_uid

)

select
    h.user_id                                                    as user_id,
    h.dataset                                                    as dataset,
    toFixedString(unhex(h.hand_uid), 16)                         as hand_uid,
    h.played_at_utc                                              as played_at_utc,
    h.played_date                                                as played_date,
    h.src_parsed_at                                              as src_parsed_at,
    h.parser_version                                             as parser_version,
    h.site                                                       as site,
    h.stake_level                                                as stake_level,
    h.game_type                                                  as game_type,
    h.table_format                                               as table_format,
    h.big_blind                                                  as big_blind,
    h.players_dealt_in                                           as players_dealt_in,

    -- ---- the action stream ----------------------------------------------------------
    arrayMap(t -> t.1, a.acts)                                   as a_idx,
    arrayMap(t -> t.2, a.acts)                                   as a_seat,
    arrayMap(t -> t.3, a.acts)                                   as a_st,
    arrayMap(t -> multiIf(
        t.4 = 'fold', 'f',
        t.4 = 'check', 'x',
        t.4 = 'call' and t.3 = 0 and t.1 < a.first_raise_idx, 'l',
        t.4 = 'call', 'c',
        t.4 = 'bet', 'b',
        t.4 = 'raise', 'r',
        'p'), a.acts)                                            as a_tok,
    arrayMap(t -> toFloat32(toFloat64(t.5) / toFloat64(h.big_blind)), a.acts) as a_amt,
    arrayMap(t -> toFloat32(toFloat64(t.6) / toFloat64(h.big_blind)), a.acts) as a_to,
    arrayMap(t -> toFloat32(toFloat64(t.7) / toFloat64(h.big_blind)), a.acts) as a_pot,
    arrayMap(t -> toFloat32(toFloat64(t.8) / toFloat64(h.big_blind)), a.acts) as a_call,
    arrayMap(t -> t.9, a.acts)                                   as a_allin,
    arrayMap(t -> t.10, a.acts)                                  as a_vol,

    -- ---- hand-level preflop facts ---------------------------------------------------
    a.first_raise_idx                                            as first_raise_idx,
    a.n_preflop_raises                                           as n_preflop_raises,
    a.opener_seat                                                as opener_seat,
    a.aggressor_seat                                             as aggressor_seat,
    multiIf(
        a.n_preflop_raises = 0, 'limped',
        a.n_preflop_raises = 1, 'srp',
        a.n_preflop_raises = 2, '3bet',
        a.n_preflop_raises = 3, '4bet',
        '5bet_plus'
    )::LowCardinality(String)                                    as pot_type,
    toFloat32(toFloat64(a.pot_at_flop) / toFloat64(h.big_blind)) as pot_at_flop_bb,
    -- The seat whose FIRST flop action comes last acts last, i.e. is in position (v1's
    -- definition, kept for parity). arrayDistinct keeps first-occurrence order.
    arrayElement(arrayDistinct(arrayFilter((s, st, t) -> st = 1 and t != 'p',
                                           a_seat, a_st, a_tok)), -1) as flop_last_seat,

    -- ---- the seats ------------------------------------------------------------------
    arrayMap(t -> t.1, s.seats)                                  as s_seat,
    arrayMap(t -> t.2, s.seats)                                  as s_position,
    arrayMap(t -> t.3, s.seats)                                  as s_player_key,
    arrayMap(t -> t.4, s.seats)                                  as s_player_key_norm,
    arrayMap(t -> t.5, s.seats)                                  as s_is_hero,
    arrayMap(t -> t.6, s.seats)                                  as s_is_anonymized,
    arrayMap(t -> t.7, s.seats)                                  as s_stack_bb,
    arrayMap(t -> t.8, s.seats)                                  as s_hole_cards,
    arrayMap(t -> t.9, s.seats)                                  as s_hand_class,
    arrayMap(t -> t.10, s.seats)                                 as s_hand_shape,
    arrayMap(t -> t.11, s.seats)                                 as s_net_won_bb,
    arrayMap(t -> t.12, s.seats)                                 as s_ev_won_bb,
    arrayMap(t -> t.13, s.seats)                                 as s_saw_flop,
    arrayMap(t -> t.14, s.seats)                                 as s_saw_turn,
    arrayMap(t -> t.15, s.seats)                                 as s_saw_river,
    arrayMap(t -> t.16, s.seats)                                 as s_went_to_showdown,
    arrayMap(t -> t.17, s.seats)                                 as s_won_hand,
    arrayMap(t -> t.19, s.seats)                                 as s_made_hand_flop,
    arrayMap(t -> t.20, s.seats)                                 as s_made_hand_turn,
    arrayMap(t -> t.21, s.seats)                                 as s_made_hand_river,
    -- Rake attributed by contribution (the "weighted contributed" convention).
    arrayMap(t -> if(s.invested_total > 0,
                     toFloat32(toFloat64(h.rake) * toFloat64(t.18)
                               / toFloat64(s.invested_total) / toFloat64(h.big_blind)),
                     toFloat32(0)), s.seats)                     as s_rake_paid_bb,
    arrayMap(x -> toUInt8(arrayExists((s2, st, v) -> s2 = x and st = 0 and v = 1,
                                      a_seat, a_st, a_vol)), s_seat)  as s_did_vpip,
    arrayMap(x -> toUInt8(arrayExists((s2, st, t) -> s2 = x and st = 0 and t = 'r',
                                      a_seat, a_st, a_tok)), s_seat)  as s_did_pfr,
    toUInt8(arraySum(s_saw_flop))                                as players_to_flop
from {{ ref('stg_hands') }} as h
inner join hand_actions as a
    on a.user_id = h.user_id and a.hand_uid = h.hand_uid
inner join seats as s
    on s.user_id = h.user_id and s.hand_uid = h.hand_uid
where {{ dirty_partitions('h.played_at_utc') }}
{% endmacro %}
