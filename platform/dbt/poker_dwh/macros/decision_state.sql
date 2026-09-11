{#
  The per-decision SELECT behind marts/decisions.sql: one row per decision point, carrying the
  state BEFORE the decision, the decision, and the hand's outcome (POKER_PLAN.md §2.3).

  A macro rather than an ephemeral model on purpose: `is_incremental()` is evaluated against
  the model that owns the SQL, and an ephemeral model is never incremental, so the dirty-
  partition gate inside it would silently become "every partition" and the pass would rebuild
  the whole corpus. Rendered inside marts/decisions.sql, the gate is that model's.

  Shape: a hand-grain subquery joins the arrays (macros/hand_arrays.sql) to the per-street
  board (both ~150k rows per daily partition), then ARRAY JOIN explodes each hand into its
  actions and keeps the decisions. Every "before this decision" fact is an array function over the prefix
  `arraySlice(a_*, 1, k - 1)`; nothing is joined at decision grain. Column names and values
  are the contract in stats/registry/dimensions.yaml.
#}

{% macro decision_state() %}
select
    user_id, dataset, hand_uid, played_at_utc, played_date,
    seat, player_key, player_key_norm, is_hero, is_anonymized,
    action_index, decision_idx, street,
    site, stake_level, game_type, table_format, big_blind, players_dealt_in, position,
    n_raises_preflop, n_limpers, n_callers_before, n_cold_callers,
    am_preflop_opener, am_preflop_aggressor, opener_position, last_raiser_position, pot_type,
    n_bets_street, n_raises_street, facing, facing_is_cbet, facing_size_pct,
    to_call_bb, pot_before_bb, invested_bb,
    players_live, players_acted_before, is_first_to_act, is_last_to_act, is_ip,
    am_prev_street_aggressor, prev_street_my_action, prev_street_faced,
    preflop_line, street_line, line_so_far,
    eff_stack_bb, spr,
    flop_suitedness, flop_pairing, flop_high_card, flop_connectedness, flop_span,
    turn_rank, turn_completes_flush, turn_pairs_board,
    river_rank, river_completes_flush, river_pairs_board,
    board_paired, board_flush_possible, board_straight_possible,
    hand_class, hand_shape, hole_cards,
    action, is_allin, amount_bb, size_pct, raise_to_bb,
    saw_next_street, went_to_showdown, won_hand, net_won_bb, ev_won_bb,
    parser_version, src_parsed_at
from (
    select
        -- ---- identity ----------------------------------------------------------------
        hb.user_id                                                   as user_id,
        hb.dataset                                                   as dataset,
        hb.hand_uid                                                  as hand_uid,
        hb.played_at_utc                                             as played_at_utc,
        hb.played_date                                               as played_date,
        hb.a_seat[k]                                                 as seat,
        hb.a_st[k]                                                   as st,
        hb.a_tok[k]                                                  as tok,
        indexOf(hb.s_seat, seat)                                     as si,
        hb.s_player_key[si]                                          as player_key,
        hb.s_player_key_norm[si]                                     as player_key_norm,
        hb.s_is_hero[si]                                             as is_hero,
        hb.s_is_anonymized[si]                                       as is_anonymized,
        hb.a_idx[k]                                                  as action_index,

        -- ---- everything before this decision -----------------------------------------
        arraySlice(hb.a_idx, 1, k - 1)                               as p_idx,
        arraySlice(hb.a_seat, 1, k - 1)                              as p_seat,
        arraySlice(hb.a_st, 1, k - 1)                                as p_st,
        arraySlice(hb.a_tok, 1, k - 1)                               as p_tok,
        arraySlice(hb.a_amt, 1, k - 1)                               as p_amt,
        arraySlice(hb.a_pot, 1, k - 1)                               as p_pot,
        arraySlice(hb.a_allin, 1, k - 1)                             as p_allin,

        toUInt8(arrayCount((s, t) -> s = seat and t != 'p', p_seat, p_tok)) as decision_idx,
        cast(multiIf(st = 0, 'preflop', st = 1, 'flop', st = 2, 'turn', 'river')
             as Enum8('preflop' = 0, 'flop' = 1, 'turn' = 2, 'river' = 3)) as street,

        -- ---- table dimensions --------------------------------------------------------
        hb.site                                                      as site,
        hb.stake_level                                               as stake_level,
        hb.game_type                                                 as game_type,
        hb.table_format                                              as table_format,
        hb.big_blind                                                 as big_blind,
        hb.players_dealt_in                                          as players_dealt_in,
        hb.s_position[si]::LowCardinality(String)                    as position,
        hb.pot_type                                                  as pot_type,

        -- ---- preflop state as of this decision ---------------------------------------
        toUInt8(arrayCount((t, s) -> s = 0 and t = 'r', p_tok, p_st))  as n_raises_preflop,
        toUInt8(arrayCount((t, s) -> s = 0 and t = 'l', p_tok, p_st))  as n_limpers,
        toUInt8(arrayCount((t, s) -> s = 0 and t = 'c', p_tok, p_st))  as n_cold_callers,
        toUInt8(arrayCount((t, s) -> s = st and t in ('l', 'c'), p_tok, p_st)) as n_callers_before,
        -- p_seat[0] is 0 (out of range reads the default), so "no raise yet" is seat 0.
        p_seat[arrayFirstIndex((t, s) -> s = 0 and t = 'r', p_tok, p_st)] as opener_seat,
        p_seat[arrayLastIndex((t, s) -> s = 0 and t = 'r', p_tok, p_st)]  as aggressor_seat,
        toUInt8(opener_seat = seat)                                  as am_preflop_opener,
        toUInt8(aggressor_seat = seat)                               as am_preflop_aggressor,
        hb.s_position[indexOf(hb.s_seat, opener_seat)]::LowCardinality(String) as opener_position,

        -- ---- this street as of this decision -----------------------------------------
        toUInt8(arrayCount((t, s) -> s = st and t in ('b', 'r'), p_tok, p_st)) as n_bets_street,
        toUInt8(arrayCount((t, s) -> s = st and t = 'r', p_tok, p_st))        as n_raises_street,
        arrayFirstIndex((t, s) -> s = st and t in ('b', 'r'), p_tok, p_st)    as first_aggr_k,
        arrayLastIndex((t, s) -> s = st and t in ('b', 'r'), p_tok, p_st)     as last_aggr_k,
        hb.s_position[indexOf(hb.s_seat, p_seat[last_aggr_k])]::LowCardinality(String)
                                                                     as last_raiser_position,
        multiIf(
            st = 0 and n_raises_preflop = 0 and n_limpers = 0, 'none',
            st = 0 and n_raises_preflop = 0, 'limp',
            st = 0 and n_raises_preflop = 1, 'raise',
            st = 0 and n_raises_preflop = 2, '3bet',
            st = 0 and n_raises_preflop = 3, '4bet',
            st = 0, '5bet_plus',
            n_bets_street = 0, 'none',
            n_bets_street = 1, 'bet',
            n_bets_street = 2, 'raise',
            '3bet'
        )::LowCardinality(String)                                    as facing,
        toUInt8(st > 0 and n_bets_street = 1 and aggressor_seat > 0
                and p_seat[first_aggr_k] = aggressor_seat)           as facing_is_cbet,
        toFloat32(coalesce(p_amt[last_aggr_k] / nullIf(p_pot[last_aggr_k], 0), 0)) as facing_size_pct,
        hb.a_call[k]                                                 as to_call_bb,
        hb.a_pot[k]                                                  as pot_before_bb,
        -- The seat's OWN chips already in the middle, blinds and antes included. `pot_before_bb`
        -- is everybody's; this is the part that is already sunk for this seat, which is what
        -- turns the hand-level `net_won_bb` into "chips won from this point"
        -- (`net_won_bb + invested_bb`) for empirical EQR -- spec §10.4, plan F.10.
        -- Safe to sum: `acts` in hand_arrays.sql keeps only posts and the five real actions, so
        -- an uncalled return is never in these arrays and there is nothing to subtract.
        toFloat32(arraySum(arrayFilter((amt, s) -> s = seat, p_amt, p_seat))) as invested_bb,

        -- ---- who is still in, who has acted ------------------------------------------
        arrayDistinct(arrayFilter((s, t) -> t = 'f', p_seat, p_tok))  as folded_seats,
        arrayDistinct(arrayFilter((s, a) -> a = 1, p_seat, p_allin))  as allin_seats,
        toUInt8(hb.players_dealt_in - length(folded_seats))          as players_live,
        toUInt8(length(arrayDistinct(arrayFilter((s, s2, t) -> s2 = st and t != 'p',
                                                 p_seat, p_st, p_tok)))) as players_acted_before,
        toUInt8(players_acted_before = 0)                            as is_first_to_act,
        -- Every other live player is "settled" for this round when it has acted on this street
        -- without folding, or is all-in and cannot act again.
        arrayDistinct(arrayConcat(
            arrayFilter((s, s2, t) -> s2 = st and t != 'p' and s != seat
                                      and not has(folded_seats, s), p_seat, p_st, p_tok),
            allin_seats))                                            as settled_seats,
        toUInt8(length(settled_seats) + 1 >= players_live)           as is_last_to_act,
        -- Acts last among the players who act on this street (first-occurrence order).
        toUInt8(arrayElement(arrayDistinct(arrayFilter((s, s2, t) -> s2 = st and t != 'p',
                                                       hb.a_seat, hb.a_st, hb.a_tok)), -1) = seat) as is_ip,

        -- ---- the previous street (complete, so the full arrays are used) --------------
        arrayLastIndex((s2, t) -> s2 = st - 1 and t in ('b', 'r'), hb.a_st, hb.a_tok) as prev_aggr_k,
        toUInt8(prev_aggr_k > 0 and hb.a_seat[prev_aggr_k] = seat)   as am_prev_street_aggressor,
        arrayStringConcat(arrayFilter((t, s, s2) -> s = seat and s2 = st - 1 and t != 'p',
                                      hb.a_tok, hb.a_seat, hb.a_st), '-') as prev_street_my_action,
        arrayLastIndex((s, s2, t) -> s = seat and s2 = st - 1 and t != 'p',
                       hb.a_seat, hb.a_st, hb.a_tok)                 as my_prev_k,
        hb.a_idx[my_prev_k]                                          as my_prev_idx,
        toUInt8(arrayCount((i, s2, t) -> s2 = st - 1 and t in ('b', 'r') and i < my_prev_idx,
                           hb.a_idx, hb.a_st, hb.a_tok))             as prev_bets,
        toUInt8(arrayCount((i, s2, t) -> s2 = 0 and t = 'l' and i < my_prev_idx,
                           hb.a_idx, hb.a_st, hb.a_tok))             as prev_limps,
        multiIf(
            my_prev_k = 0, 'none',
            st = 1 and prev_bets = 0 and prev_limps = 0, 'none',
            st = 1 and prev_bets = 0, 'limp',
            st = 1 and prev_bets = 1, 'raise',
            st = 1 and prev_bets = 2, '3bet',
            st = 1 and prev_bets = 3, '4bet',
            st = 1, '5bet_plus',
            prev_bets = 0, 'none',
            prev_bets = 1, 'bet',
            prev_bets = 2, 'raise',
            '3bet'
        )::LowCardinality(String)                                    as prev_street_faced,

        -- ---- action lines (own actions; tokens in dimensions.yaml) --------------------
        arrayStringConcat(arrayFilter((t, s, s2) -> s = seat and s2 = 0 and t != 'p',
                                      p_tok, p_seat, p_st), '-')     as preflop_line,
        arrayStringConcat(arrayFilter((t, s, s2) -> s = seat and s2 = st and t != 'p',
                                      p_tok, p_seat, p_st), '-')     as street_line,
        arrayStringConcat(arrayMap(
            x -> arrayStringConcat(arrayFilter((t, s, s2) -> s = seat and s2 = x and t != 'p',
                                               p_tok, p_seat, p_st), '-'),
            range(st + 1)), '/')                                     as line_so_far,

        -- ---- depth -------------------------------------------------------------------
        hb.s_stack_bb[si] - arraySum(arrayFilter((a, s) -> s = seat, p_amt, p_seat)) as my_behind,
        arrayMax(arrayMap(
            j -> hb.s_stack_bb[j] - arraySum(arrayFilter((a, s) -> s = hb.s_seat[j], p_amt, p_seat)),
            arrayFilter(j -> hb.s_seat[j] != seat and not has(folded_seats, hb.s_seat[j]),
                        arrayEnumerate(hb.s_seat))))                 as opp_behind,
        toFloat32(greatest(least(my_behind, opp_behind), 0))          as eff_stack_bb,
        toFloat32(if(pot_before_bb > 0, eff_stack_bb / pot_before_bb, 0)) as spr,

        -- ---- the board at this street ------------------------------------------------
        if(st >= 1, hb.b_flop_suitedness, '')::LowCardinality(String)    as flop_suitedness,
        if(st >= 1, hb.b_flop_pairing, '')::LowCardinality(String)       as flop_pairing,
        if(st >= 1, hb.b_flop_high_card, '')::LowCardinality(String)     as flop_high_card,
        if(st >= 1, hb.b_flop_connectedness, '')::LowCardinality(String) as flop_connectedness,
        if(st >= 1, hb.b_flop_span, 0)::UInt8                            as flop_span,
        if(st >= 2, hb.b_turn_rank, '')::LowCardinality(String)          as turn_rank,
        if(st >= 2, hb.b_turn_completes_flush, 0)::UInt8                 as turn_completes_flush,
        if(st >= 2, hb.b_turn_pairs_board, 0)::UInt8                     as turn_pairs_board,
        if(st >= 3, hb.b_river_rank, '')::LowCardinality(String)         as river_rank,
        if(st >= 3, hb.b_river_completes_flush, 0)::UInt8                as river_completes_flush,
        if(st >= 3, hb.b_river_pairs_board, 0)::UInt8                    as river_pairs_board,
        multiIf(st = 1, hb.b_paired_flop, st = 2, hb.b_paired_turn, st = 3, hb.b_paired_river, 0)::UInt8
                                                                     as board_paired,
        multiIf(st = 1, hb.b_flush_flop, st = 2, hb.b_flush_turn, st = 3, hb.b_flush_river, 0)::UInt8
                                                                     as board_flush_possible,
        multiIf(st = 1, hb.b_straight_flop, st = 2, hb.b_straight_turn, st = 3, hb.b_straight_river, 0)::UInt8
                                                                     as board_straight_possible,

        -- ---- holding -----------------------------------------------------------------
        hb.s_hand_class[si]::LowCardinality(String)                  as hand_class,
        hb.s_hand_shape[si]::LowCardinality(String)                  as hand_shape,
        hb.s_hole_cards[si]                                          as hole_cards,

        -- ---- the decision ------------------------------------------------------------
        cast(multiIf(tok = 'f', 'fold', tok = 'x', 'check', tok in ('l', 'c'), 'call',
                     tok = 'b', 'bet', 'raise')
             as Enum8('fold' = 0, 'check' = 1, 'call' = 2, 'bet' = 3, 'raise' = 4)) as action,
        hb.a_allin[k]                                                as is_allin,
        hb.a_amt[k]                                                  as amount_bb,
        toFloat32(if(tok in ('b', 'r'), coalesce(hb.a_amt[k] / nullIf(pot_before_bb, 0), 0), 0)) as size_pct,
        toFloat32(if(tok = 'r', hb.a_to[k], 0))                      as raise_to_bb,

        -- ---- the outcome (hand level, repeated) --------------------------------------
        multiIf(st = 0, hb.s_saw_flop[si], st = 1, hb.s_saw_turn[si],
                st = 2, hb.s_saw_river[si], hb.s_went_to_showdown[si]) as saw_next_street,
        hb.s_went_to_showdown[si]                                    as went_to_showdown,
        hb.s_won_hand[si]                                            as won_hand,
        hb.s_net_won_bb[si]                                          as net_won_bb,
        hb.s_ev_won_bb[si]                                           as ev_won_bb,
        hb.parser_version                                            as parser_version,
        hb.src_parsed_at                                             as src_parsed_at
    from (
        select
            h.*,
            b.flop_suitedness        as b_flop_suitedness,
            b.flop_pairing           as b_flop_pairing,
            b.flop_high_card         as b_flop_high_card,
            b.flop_connectedness     as b_flop_connectedness,
            b.flop_span              as b_flop_span,
            b.turn_rank              as b_turn_rank,
            b.turn_completes_flush   as b_turn_completes_flush,
            b.turn_pairs_board       as b_turn_pairs_board,
            b.river_rank             as b_river_rank,
            b.river_completes_flush  as b_river_completes_flush,
            b.river_pairs_board      as b_river_pairs_board,
            b.paired_flop            as b_paired_flop,
            b.paired_turn            as b_paired_turn,
            b.paired_river           as b_paired_river,
            b.flush_flop             as b_flush_flop,
            b.flush_turn             as b_flush_turn,
            b.flush_river            as b_flush_river,
            b.straight_flop          as b_straight_flop,
            b.straight_turn          as b_straight_turn,
            b.straight_river         as b_straight_river
        from ({{ hand_arrays() }}) as h
        left join {{ ref('int_board_by_street') }} as b
            on b.user_id = h.user_id and b.hand_uid = h.hand_uid
           and {{ dirty_partitions('b.played_at_utc') }}
        where {{ dirty_partitions('h.played_at_utc') }}
    ) as hb
    array join arrayEnumerate(hb.a_idx) as k
    where hb.a_tok[k] != 'p'
)
{% endmacro %}
