-- ★ THE MODEL THE WHOLE STAT LAYER RESTS ON.
--
-- One wide row per (hand, player), carrying an opportunity/action counter PAIR for every
-- stat. Every poker statistic is then `sum(action) / sum(opportunity)` -- sliceable by any
-- dimension, over any date range, with no new SQL.
--
-- Why this shape instead of one query per stat: without it, "VPIP by position for NL50 in
-- March" and "VPIP by position for NL100 in April" are two different queries, and thirty
-- stats become thirty models that each re-derive the action sequence. With it, they are one
-- table and a GROUP BY. Both PT4 and HM3 do this internally; it is the standard solution.
--
-- The counters are UInt8 (0 or 1) per hand. Summing them is exact -- no floating point
-- anywhere in the stat path.
--
-- IMPLEMENTATION NOTE: the joined relations are referenced DIRECTLY with aliases rather than
-- wrapped in CTEs. ClickHouse's analyzer fails to resolve qualified identifiers across
-- several LEFT JOINs onto CTEs ("Identifier 'x.user_id' cannot be resolved from subquery"),
-- so CTEs are used only for the scalar/derived pieces that are joined once.

with aggressor as (

    -- The preflop aggressor's seat, needed to decide whose flop bet counts as a c-bet.
    select distinct user_id, hand_uid, aggressor_seat
    from {{ ref('int_preflop_context') }}
    where aggressor_seat > 0

)

-- Alias EVERY column. ClickHouse keeps the table qualifier in the output column name for any
-- column present in more than one joined relation, producing columns literally named
-- "p.user_id" that nothing downstream can reference. See int_preflop_context.sql.
select
    p.user_id                                                        as user_id,
    p.hand_uid                                                       as hand_uid,
    p.played_at_utc                                                  as played_at_utc,
    p.played_date                                                    as played_date,
    p.seat                                                           as seat,
    p.player_key                                                     as player_key,
    p.is_hero                                                        as is_hero,
    p.is_anonymized                                                  as is_anonymized,

    -- ---- dimensions every stat can be sliced by (free: they are columns on this row) ----
    h.site                                                           as site,
    h.stake_level                                                    as stake_level,
    h.game_type                                                      as game_type,
    h.table_format                                                   as table_format,
    h.big_blind                                                      as big_blind,
    p.position                                                       as position,
    h.players_dealt_in                                               as players_dealt_in,

    -- ---- the universal denominator ----------------------------------------------------
    toUInt8(1)                                                       as hands,

    -- ---- preflop ----------------------------------------------------------------------
    -- VPIP: every hand dealt in is an opportunity; voluntarily putting money in is the
    -- action. Blind posts are excluded by `is_voluntary` upstream -- that is the whole trick.
    toUInt8(1)                                                       as vpip_opp,
    toUInt8(coalesce(pf.did_vpip, 0))                                as vpip_action,

    toUInt8(1)                                                       as pfr_opp,
    toUInt8(coalesce(pf.did_raise, 0))                               as pfr_action,

    -- 3-bet: facing EXACTLY ONE raise when you first act.
    toUInt8(pf.raises_before = 1)                                    as threebet_opp,
    toUInt8(pf.raises_before = 1 and pf.first_action = 'raise')      as threebet_action,

    -- Fold to 3-bet: you opened, someone re-raised -- what did you do?
    toUInt8(pf.is_preflop_opener = 1 and pf.n_preflop_raises >= 2)   as fold_to_3bet_opp,
    toUInt8(pf.is_preflop_opener = 1 and pf.n_preflop_raises >= 2
            and pf.last_action = 'fold')                             as fold_to_3bet_action,

    -- 4-bet: facing two raises.
    toUInt8(pf.raises_before = 2)                                    as fourbet_opp,
    toUInt8(pf.raises_before = 2 and pf.first_action = 'raise')      as fourbet_action,

    -- Steal: first in from CO/BTN/SB.
    toUInt8(p.position in ('CO', 'BTN', 'SB') and pf.n_voluntary_before = 0)
                                                                     as steal_opp,
    toUInt8(p.position in ('CO', 'BTN', 'SB') and pf.n_voluntary_before = 0
            and pf.first_action = 'raise')                           as steal_action,

    -- Fold BB to steal: you are the big blind and a late-position player opened first in.
    toUInt8(p.position = 'BB' and pf.raises_before = 1
            and pf.first_raiser_position in ('CO', 'BTN', 'SB'))     as fold_bb_steal_opp,
    toUInt8(p.position = 'BB' and pf.raises_before = 1
            and pf.first_raiser_position in ('CO', 'BTN', 'SB')
            and pf.first_action = 'fold')                            as fold_bb_steal_action,

    -- ---- postflop aggression -----------------------------------------------------------
    -- C-bet: you were the preflop aggressor AND you saw the flop.
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1)          as cbet_flop_opp,
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1
            and coalesce(fl.did_bet, 0) = 1)                         as cbet_flop_action,

    -- Double barrel: you c-bet the flop, got called, and saw the turn.
    toUInt8(pf.is_preflop_aggressor = 1 and coalesce(fl.did_bet, 0) = 1
            and p.saw_turn = 1)                                      as cbet_turn_opp,
    toUInt8(pf.is_preflop_aggressor = 1 and coalesce(fl.did_bet, 0) = 1
            and p.saw_turn = 1 and coalesce(tn.did_bet, 0) = 1)      as cbet_turn_action,

    -- Fold to flop c-bet: you faced the aggressor's flop bet.
    toUInt8(p.saw_flop = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(fl.faced_aggression, 0) = 1
            and fl.first_bettor_seat = ag.aggressor_seat)            as fold_to_cbet_f_opp,
    toUInt8(p.saw_flop = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(fl.faced_aggression, 0) = 1
            and fl.first_bettor_seat = ag.aggressor_seat
            and coalesce(fl.did_fold, 0) = 1)                        as fold_to_cbet_f_action,

    -- Check-raise: you checked, someone bet behind you, and then you raised.
    toUInt8(coalesce(fl.had_checkraise_chance, 0) = 1)               as checkraise_f_opp,
    toUInt8(coalesce(fl.had_checkraise_chance, 0) = 1
            and coalesce(fl.did_raise, 0) = 1)                       as checkraise_f_action,

    -- ---- showdown ------------------------------------------------------------------------
    toUInt8(p.saw_flop = 1)                                          as wwsf_opp,
    toUInt8(p.saw_flop = 1 and p.won_hand = 1)                       as wwsf_action,
    toUInt8(p.saw_flop = 1)                                          as wtsd_opp,
    toUInt8(p.saw_flop = 1 and p.went_to_showdown = 1)               as wtsd_action,
    toUInt8(p.went_to_showdown = 1)                                  as wsd_opp,
    toUInt8(p.went_to_showdown = 1 and p.won_hand = 1)               as wsd_action,

    -- ---- money ---------------------------------------------------------------------------
    p.net_won_bb                                                     as net_won_bb,
    -- EV bb falls back to the actual result when no all-in occurred, so the EV line and the
    -- winnings line coincide everywhere an all-in did not happen. That is what makes the gap
    -- between the two lines readable as "run good / run bad".
    coalesce(p.ev_won_bb, p.net_won_bb)                              as ev_won_bb,
    if(p.went_to_showdown = 1, p.net_won_bb, toDecimal64(0, 4))      as showdown_won_bb,
    if(p.went_to_showdown = 1, toDecimal64(0, 4), p.net_won_bb)      as nonshowdown_won_bb,

    h.parser_version                                                 as parser_version

from {{ ref('stg_hand_players') }} as p
inner join {{ ref('stg_hands') }} as h
    on h.user_id = p.user_id and h.hand_uid = p.hand_uid
left join {{ ref('int_preflop_context') }} as pf
    on pf.user_id = p.user_id and pf.hand_uid = p.hand_uid and pf.seat = p.seat
left join {{ ref('int_postflop_context') }} as fl
    on fl.user_id = p.user_id and fl.hand_uid = p.hand_uid and fl.seat = p.seat
   and fl.street = 'flop'
left join {{ ref('int_postflop_context') }} as tn
    on tn.user_id = p.user_id and tn.hand_uid = p.hand_uid and tn.seat = p.seat
   and tn.street = 'turn'
left join aggressor as ag
    on ag.user_id = p.user_id and ag.hand_uid = p.hand_uid
