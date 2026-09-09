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

{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    engine='MergeTree()',
    order_by='(user_id, hand_uid, seat)',
    partition_by='toYYYYMMDD(played_at_utc)',
  )
}}

with aggressor as (

    -- The preflop aggressor's seat, needed to decide whose flop bet counts as a c-bet.
    select distinct user_id, hand_uid, aggressor_seat
    from {{ ref('int_preflop_context') }}
    where aggressor_seat > 0 and {{ dirty_partitions('played_at_utc') }}

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
    h.dataset                                                        as dataset,
    h.site                                                           as site,
    h.stake_level                                                    as stake_level,
    h.game_type                                                      as game_type,
    h.table_format                                                   as table_format,
    h.big_blind                                                      as big_blind,
    p.position                                                       as position,
    h.players_dealt_in                                               as players_dealt_in,

    -- Preflop shape of the pot. The most important postflop dimension after position: a c-bet
    -- in a 4-bet pot and a c-bet in a limped pot are not the same action.
    hx.pot_type                                                      as pot_type,
    hx.players_to_flop                                               as players_to_flop,
    hx.is_multiway                                                   as is_multiway,
    coalesce(pf.first_raiser_position, '')                           as vs_position,

    -- Holding and depth.
    coalesce(pc.hand_class, '')                                      as hand_class,
    coalesce(pc.hand_shape, '')                                      as hand_shape,
    coalesce(pc.spr_bucket, 'na')                                    as spr_bucket,
    coalesce(pc.stack_bucket, '')                                    as stack_bucket,
    coalesce(pc.is_ip, toUInt8(0))                                   as is_ip,

    -- Board texture. '' on hands that never saw a flop, which groups cleanly.
    coalesce(bt.flop_suitedness, '')                                 as flop_suitedness,
    coalesce(bt.flop_pairing, '')                                    as flop_pairing,
    coalesce(bt.flop_high_card, '')                                  as flop_high_card,
    coalesce(bt.flop_connectedness, '')                              as flop_connectedness,
    coalesce(bt.board_paired_final, toUInt8(0))                      as board_paired_final,
    coalesce(bt.board_flush_possible, toUInt8(0))                    as board_flush_possible,

    -- Bet sizing, per street: the dimension that separates "I c-bet 62%" from a real read.
    coalesce(fl.bet_size_bucket, 'none')                             as bet_size_bucket_f,
    coalesce(tn.bet_size_bucket, 'none')                             as bet_size_bucket_t,
    coalesce(rv.bet_size_bucket, 'none')                             as bet_size_bucket_r,
    coalesce(fl.faced_size_bucket, 'none')                           as faced_size_bucket_f,
    coalesce(tn.faced_size_bucket, 'none')                           as faced_size_bucket_t,
    coalesce(rv.faced_size_bucket, 'none')                           as faced_size_bucket_r,

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
    toUInt8(coalesce(pf.has_decision, 0) = 1 and p.position in ('CO', 'BTN', 'SB')
            and pf.n_voluntary_before = 0)                           as steal_opp,
    toUInt8(coalesce(pf.has_decision, 0) = 1 and p.position in ('CO', 'BTN', 'SB')
            and pf.n_voluntary_before = 0
            and pf.first_action = 'raise')                           as steal_action,

    -- Fold BB to steal: you are the big blind and a late-position player opened first in.
    toUInt8(p.position = 'BB' and pf.raises_before = 1
            and pf.first_raiser_position in ('CO', 'BTN', 'SB'))     as fold_bb_steal_opp,
    toUInt8(p.position = 'BB' and pf.raises_before = 1
            and pf.first_raiser_position in ('CO', 'BTN', 'SB')
            and pf.first_action = 'fold')                            as fold_bb_steal_action,

    -- ---- FACING AN OPEN: one generic triple, not one counter per seat -----------------
    -- Everyone who faces exactly one raise is in the same decision: call, fold, or 3-bet.
    -- Encoding that once and slicing by `position` and `vs_position` covers cold-calling
    -- (position not a blind), big-blind defence, small-blind defence, and "how does the field
    -- react to a button open" -- all from three columns. The alternative, a bespoke
    -- `bb_call_opp` / `sb_call_opp` / `cold_call_opp` per seat, multiplies the flag table
    -- every time a new question is asked and is why this model kept needing edits.
    -- NOTE: unlike `cold_call_*` below, this INCLUDES the blinds.
    toUInt8(pf.raises_before = 1)                                    as vs_open_opp,
    toUInt8(pf.raises_before = 1 and pf.first_action = 'call')       as vs_open_call,
    toUInt8(pf.raises_before = 1 and pf.first_action = 'fold')       as vs_open_fold,

    -- Facing a 4-bet, as the player who 3-bet. `fold_to_4bet_*` is the fold half of this same
    -- opportunity; this adds the call half so the three responses sum to the opportunity.
    toUInt8(pf.raises_before = 1 and pf.first_action = 'raise'
            and pf.n_preflop_raises >= 3)                            as vs_4bet_opp,
    toUInt8(pf.raises_before = 1 and pf.first_action = 'raise'
            and pf.n_preflop_raises >= 3
            and pf.last_action = 'call')                             as vs_4bet_call,

    -- RFI (raise first in): the generic version of steal, for EVERY position rather than just
    -- the late ones. This is what "opening range from UTG" is measured against.
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0) as rfi_opp,
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0
            and pf.first_action = 'raise')                           as rfi_action,

    -- Limp: first in, and chose to call the big blind instead of raising.
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0
            and p.position not in ('BB'))                            as limp_opp,
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0
            and p.position not in ('BB')
            and pf.first_action = 'call')                            as limp_action,

    -- Isolation raise: there are limpers in front and nobody has raised.
    toUInt8(pf.n_limpers_before > 0 and pf.raises_before = 0)        as iso_opp,
    toUInt8(pf.n_limpers_before > 0 and pf.raises_before = 0
            and pf.first_action = 'raise')                           as iso_action,

    -- Cold call: facing a raise, not already invested as a blind.
    toUInt8(pf.raises_before >= 1 and p.position not in ('SB', 'BB')) as cold_call_opp,
    toUInt8(pf.raises_before >= 1 and p.position not in ('SB', 'BB')
            and pf.first_action = 'call')                            as cold_call_action,

    -- Squeeze: a raise AND at least one cold caller in front of you. Folded into plain
    -- "3-bet %" it hides how much tighter most players are here.
    toUInt8(pf.raises_before = 1 and pf.n_cold_callers_before > 0)   as squeeze_opp,
    toUInt8(pf.raises_before = 1 and pf.n_cold_callers_before > 0
            and pf.first_action = 'raise')                           as squeeze_action,

    -- Call vs fold a 3-bet, as separate actions on the same opportunity as fold_to_3bet.
    toUInt8(pf.is_preflop_opener = 1 and pf.n_preflop_raises >= 2)   as call_3bet_opp,
    toUInt8(pf.is_preflop_opener = 1 and pf.n_preflop_raises >= 2
            and pf.last_action = 'call')                             as call_3bet_action,

    -- 5-bet: facing three raises.
    toUInt8(pf.raises_before = 3)                                    as fivebet_opp,
    toUInt8(pf.raises_before = 3 and pf.first_action = 'raise')      as fivebet_action,

    -- Fold to a 4-bet: you 3-bet and got re-raised.
    toUInt8(pf.raises_before = 1 and pf.first_action = 'raise'
            and pf.n_preflop_raises >= 3)                            as fold_to_4bet_opp,
    toUInt8(pf.raises_before = 1 and pf.first_action = 'raise'
            and pf.n_preflop_raises >= 3
            and pf.last_action = 'fold')                             as fold_to_4bet_action,

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

    -- Triple barrel: you c-bet the turn and saw the river. The stat your question about
    -- river c-bet frequency is actually asking for.
    toUInt8(pf.is_preflop_aggressor = 1 and coalesce(tn.did_bet, 0) = 1
            and p.saw_river = 1)                                     as cbet_river_opp,
    toUInt8(pf.is_preflop_aggressor = 1 and coalesce(tn.did_bet, 0) = 1
            and p.saw_river = 1 and coalesce(rv.did_bet, 0) = 1)     as cbet_river_action,

    -- Fold to the c-bet on later streets. Same shape as the flop version.
    toUInt8(p.saw_turn = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(tn.faced_aggression, 0) = 1
            and tn.first_bettor_seat = ag.aggressor_seat)            as fold_to_cbet_t_opp,
    toUInt8(p.saw_turn = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(tn.faced_aggression, 0) = 1
            and tn.first_bettor_seat = ag.aggressor_seat
            and coalesce(tn.did_fold, 0) = 1)                        as fold_to_cbet_t_action,
    toUInt8(p.saw_river = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(rv.faced_aggression, 0) = 1
            and rv.first_bettor_seat = ag.aggressor_seat)            as fold_to_cbet_r_opp,
    toUInt8(p.saw_river = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(rv.faced_aggression, 0) = 1
            and rv.first_bettor_seat = ag.aggressor_seat
            and coalesce(rv.did_fold, 0) = 1)                        as fold_to_cbet_r_action,

    -- Donk bet: leading INTO the preflop aggressor rather than checking to them. Rare, and a
    -- reliable population-wide marker of a weak player when it is frequent.
    toUInt8(p.saw_flop = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(pc.is_ip, 0) = 0)                           as donk_f_opp,
    toUInt8(p.saw_flop = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(pc.is_ip, 0) = 0
            and fl.first_bettor_seat = p.seat)                       as donk_f_action,

    -- Probe: the aggressor gave up on the flop and you bet the turn out of position.
    toUInt8(p.saw_turn = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(fl.n_aggressive, 0) = 0)                    as probe_t_opp,
    toUInt8(p.saw_turn = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(fl.n_aggressive, 0) = 0
            and tn.first_bettor_seat = p.seat)                       as probe_t_action,

    -- Delayed c-bet: you were the aggressor, checked the flop back, then bet the turn.
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1
            and coalesce(fl.did_bet, 0) = 0 and p.saw_turn = 1)      as delayed_cbet_opp,
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1
            and coalesce(fl.did_bet, 0) = 0 and p.saw_turn = 1
            and coalesce(tn.did_bet, 0) = 1)                         as delayed_cbet_action,

    -- Float: called a flop bet in position, then bet the turn when checked to.
    toUInt8(p.saw_flop = 1 and coalesce(pc.is_ip, 0) = 1
            and coalesce(fl.faced_aggression, 0) = 1
            and coalesce(fl.did_call_street, 0) = 1
            and p.saw_turn = 1)                                      as float_opp,
    toUInt8(p.saw_flop = 1 and coalesce(pc.is_ip, 0) = 1
            and coalesce(fl.faced_aggression, 0) = 1
            and coalesce(fl.did_call_street, 0) = 1
            and p.saw_turn = 1 and coalesce(tn.did_bet, 0) = 1)      as float_action,

    -- Check-raise: you checked, someone bet behind you, and then you raised.
    toUInt8(coalesce(fl.had_checkraise_chance, 0) = 1)               as checkraise_f_opp,
    toUInt8(coalesce(fl.had_checkraise_chance, 0) = 1
            and coalesce(fl.did_raise, 0) = 1)                       as checkraise_f_action,
    toUInt8(coalesce(tn.had_checkraise_chance, 0) = 1)               as checkraise_t_opp,
    toUInt8(coalesce(tn.had_checkraise_chance, 0) = 1
            and coalesce(tn.did_raise, 0) = 1)                       as checkraise_t_action,
    toUInt8(coalesce(rv.had_checkraise_chance, 0) = 1)               as checkraise_r_opp,
    toUInt8(coalesce(rv.had_checkraise_chance, 0) = 1
            and coalesce(rv.did_raise, 0) = 1)                       as checkraise_r_action,

    -- ---- limp follow-through -----------------------------------------------------------
    -- Opportunity is "limped AND somebody raised behind" — a limp that walks to the flop was
    -- never a fold/call/raise decision and must not sit in the denominator.
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0
            and p.position not in ('BB') and pf.first_action = 'call'
            and pf.n_preflop_raises >= 1)                            as limp_faced_raise_opp,
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0
            and p.position not in ('BB') and pf.first_action = 'call'
            and pf.n_preflop_raises >= 1 and pf.last_action = 'fold') as limp_fold_action,
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0
            and p.position not in ('BB') and pf.first_action = 'call'
            and pf.n_preflop_raises >= 1 and pf.last_action = 'call') as limp_call_action,
    toUInt8(coalesce(pf.has_decision, 0) = 1 and pf.n_voluntary_before = 0
            and p.position not in ('BB') and pf.first_action = 'call'
            and pf.n_preflop_raises >= 1 and pf.last_action = 'raise') as limp_raise_action,

    -- ---- responses to a flop c-bet (same opportunity as fold_to_cbet_f) ------------------
    toUInt8(p.saw_flop = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(fl.faced_aggression, 0) = 1
            and fl.first_bettor_seat = ag.aggressor_seat
            and coalesce(fl.did_raise, 0) = 1)                       as raise_cbet_f_action,

    -- Float-fold: called the flop c-bet, then folded the turn. Denominator is only players who
    -- actually reached the turn — folding a street you never saw is not a decision.
    toUInt8(p.saw_flop = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(fl.faced_aggression, 0) = 1
            and fl.first_bettor_seat = ag.aggressor_seat
            and coalesce(fl.did_call_street, 0) = 1
            and p.saw_turn = 1)                                      as float_fold_opp,
    toUInt8(p.saw_flop = 1 and coalesce(pf.is_preflop_aggressor, 0) = 0
            and coalesce(fl.faced_aggression, 0) = 1
            and fl.first_bettor_seat = ag.aggressor_seat
            and coalesce(fl.did_call_street, 0) = 1
            and p.saw_turn = 1 and coalesce(tn.did_fold, 0) = 1)     as float_fold_action,

    -- Fold to a donk: the aggressor was led into.
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1
            and coalesce(fl.faced_aggression, 0) = 1
            and fl.first_bettor_seat != ag.aggressor_seat)           as fold_to_donk_opp,
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1
            and coalesce(fl.faced_aggression, 0) = 1
            and fl.first_bettor_seat != ag.aggressor_seat
            and coalesce(fl.did_fold, 0) = 1)                        as fold_to_donk_action,

    -- ---- folding to a RAISE after betting, per street -------------------------------------
    -- `n_aggressive >= 2` on a street the player bet into means somebody raised over the top.
    toUInt8(coalesce(fl.did_bet, 0) = 1 and coalesce(fl.n_aggressive, 0) >= 2)
                                                                     as fold_to_flop_raise_opp,
    toUInt8(coalesce(fl.did_bet, 0) = 1 and coalesce(fl.n_aggressive, 0) >= 2
            and coalesce(fl.did_fold, 0) = 1)                        as fold_to_flop_raise_action,
    toUInt8(coalesce(tn.did_bet, 0) = 1 and coalesce(tn.n_aggressive, 0) >= 2)
                                                                     as fold_to_turn_raise_opp,
    toUInt8(coalesce(tn.did_bet, 0) = 1 and coalesce(tn.n_aggressive, 0) >= 2
            and coalesce(tn.did_fold, 0) = 1)                        as fold_to_turn_raise_action,
    toUInt8(coalesce(rv.did_bet, 0) = 1 and coalesce(rv.n_aggressive, 0) >= 2)
                                                                     as fold_to_river_raise_opp,
    toUInt8(coalesce(rv.did_bet, 0) = 1 and coalesce(rv.n_aggressive, 0) >= 2
            and coalesce(rv.did_fold, 0) = 1)                        as fold_to_river_raise_action,
    -- The call half of that same river opportunity: bet-call vs bet-fold.
    toUInt8(coalesce(rv.did_bet, 0) = 1 and coalesce(rv.n_aggressive, 0) >= 2
            and coalesce(rv.did_call_street, 0) = 1)                 as bet_call_river_action,

    -- ---- facing a probe / delayed c-bet as the aggressor who checked ---------------------
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1
            and coalesce(fl.n_aggressive, 0) = 0 and p.saw_turn = 1
            and coalesce(tn.faced_aggression, 0) = 1)                as fold_to_probe_t_opp,
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_flop = 1
            and coalesce(fl.n_aggressive, 0) = 0 and p.saw_turn = 1
            and coalesce(tn.faced_aggression, 0) = 1
            and coalesce(tn.did_fold, 0) = 1)                        as fold_to_probe_t_action,
    toUInt8(coalesce(pf.is_preflop_aggressor, 0) = 0 and p.saw_turn = 1
            and coalesce(fl.n_aggressive, 0) = 0
            and coalesce(tn.faced_aggression, 0) = 1
            and tn.first_bettor_seat = ag.aggressor_seat)            as fold_to_delayed_cbet_opp,
    toUInt8(coalesce(pf.is_preflop_aggressor, 0) = 0 and p.saw_turn = 1
            and coalesce(fl.n_aggressive, 0) = 0
            and coalesce(tn.faced_aggression, 0) = 1
            and tn.first_bettor_seat = ag.aggressor_seat
            and coalesce(tn.did_fold, 0) = 1)                        as fold_to_delayed_cbet_action,

    -- ---- river probe (turn checked through, non-aggressor bets river) -------------------
    toUInt8(coalesce(pf.is_preflop_aggressor, 0) = 0 and p.saw_river = 1
            and coalesce(tn.n_aggressive, 0) = 0)                    as probe_r_opp,
    toUInt8(coalesce(pf.is_preflop_aggressor, 0) = 0 and p.saw_river = 1
            and coalesce(tn.n_aggressive, 0) = 0
            and rv.first_bettor_seat = p.seat)                       as probe_r_action,
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_river = 1
            and coalesce(tn.n_aggressive, 0) = 0
            and coalesce(rv.faced_aggression, 0) = 1)                as fold_to_probe_r_opp,
    toUInt8(pf.is_preflop_aggressor = 1 and p.saw_river = 1
            and coalesce(tn.n_aggressive, 0) = 0
            and coalesce(rv.faced_aggression, 0) = 1
            and coalesce(rv.did_fold, 0) = 1)                        as fold_to_probe_r_action,

    -- ---- river: raising, and what a river check surrenders ------------------------------
    toUInt8(coalesce(rv.faced_aggression, 0) = 1)                    as river_face_bet_opp,
    toUInt8(coalesce(rv.faced_aggression, 0) = 1
            and coalesce(rv.did_raise, 0) = 1)                       as river_raise_action,
    toUInt8(coalesce(rv.did_check, 0) = 1
            and coalesce(rv.faced_aggression, 0) = 1)                as river_check_faced_opp,
    toUInt8(coalesce(rv.did_check, 0) = 1
            and coalesce(rv.faced_aggression, 0) = 1
            and coalesce(rv.did_fold, 0) = 1)                        as river_check_fold_action,
    toUInt8(coalesce(rv.did_check, 0) = 1
            and coalesce(rv.faced_aggression, 0) = 1
            and coalesce(rv.did_call_street, 0) = 1)                 as river_check_call_action,

    -- ---- raw aggression counts, per street ---------------------------------------------
    -- The inputs to Aggression Factor and Aggression Frequency. Kept as raw counts rather
    -- than a precomputed ratio so the caller decides the denominator -- which is the whole
    -- point of the custom-stat feature.
    toUInt8(coalesce(fl.did_bet, 0) + coalesce(fl.did_raise, 0))     as aggr_f,
    toUInt8(coalesce(tn.did_bet, 0) + coalesce(tn.did_raise, 0))     as aggr_t,
    toUInt8(coalesce(rv.did_bet, 0) + coalesce(rv.did_raise, 0))     as aggr_r,
    toUInt8(coalesce(fl.did_call_street, 0))                         as call_f,
    toUInt8(coalesce(tn.did_call_street, 0))                         as call_t,
    toUInt8(coalesce(rv.did_call_street, 0))                         as call_r,
    toUInt8(coalesce(fl.did_fold, 0))                                as fold_f,
    toUInt8(coalesce(tn.did_fold, 0))                                as fold_t,
    toUInt8(coalesce(rv.did_fold, 0))                                as fold_r,

    -- ---- street progression --------------------------------------------------------------
    toUInt8(p.saw_flop)                                              as saw_flop,
    toUInt8(p.saw_turn)                                              as saw_turn,
    toUInt8(p.saw_river)                                             as saw_river,
    toUInt8(p.saw_turn = 1)                                          as saw_river_opp,
    toUInt8(p.saw_river = 1)                                         as saw_river_action,

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

    h.parser_version                                                 as parser_version,

    -- Ingestion watermark. `max()` of this column is what the next incremental run compares
    -- against core.hands.parsed_at to decide which months to rebuild -- macros/incremental.sql.
    -- Taken from the hand, not the player row, so it matches the authority exactly.
    h.src_parsed_at                                                  as src_parsed_at

-- **Every relation carries the same dirty-partition gate.** ClickHouse builds the right-hand
-- side of a join in memory and will not push the predicate on `p` across the join for us, so
-- gating only the driving table would still hash all 54M rows of each right side -- which is
-- the whole reason a full refresh needed 15 GB. The gate is a no-op (`1`) on a full refresh.
from {{ ref('stg_hand_players') }} as p
inner join {{ ref('stg_hands') }} as h
    on h.user_id = p.user_id and h.hand_uid = p.hand_uid
   and {{ dirty_partitions('h.played_at_utc') }}
left join {{ ref('int_preflop_context') }} as pf
    on pf.user_id = p.user_id and pf.hand_uid = p.hand_uid and pf.seat = p.seat
   and {{ dirty_partitions('pf.played_at_utc') }}
left join {{ ref('int_postflop_context') }} as fl
    on fl.user_id = p.user_id and fl.hand_uid = p.hand_uid and fl.seat = p.seat
   and fl.street = 'flop'
   and {{ dirty_partitions('fl.played_at_utc') }}
left join {{ ref('int_postflop_context') }} as tn
    on tn.user_id = p.user_id and tn.hand_uid = p.hand_uid and tn.seat = p.seat
   and tn.street = 'turn'
   and {{ dirty_partitions('tn.played_at_utc') }}
left join {{ ref('int_postflop_context') }} as rv
    on rv.user_id = p.user_id and rv.hand_uid = p.hand_uid and rv.seat = p.seat
   and rv.street = 'river'
   and {{ dirty_partitions('rv.played_at_utc') }}
left join {{ ref('int_hand_context') }} as hx
    on hx.user_id = p.user_id and hx.hand_uid = p.hand_uid
   and {{ dirty_partitions('hx.played_at_utc') }}
left join {{ ref('int_player_context') }} as pc
    on pc.user_id = p.user_id and pc.hand_uid = p.hand_uid and pc.seat = p.seat
   and {{ dirty_partitions('pc.played_at_utc') }}
left join {{ ref('int_board_texture') }} as bt
    on bt.user_id = p.user_id and bt.hand_uid = p.hand_uid
   and {{ dirty_partitions('bt.played_at_utc') }}
left join aggressor as ag
    on ag.user_id = p.user_id and ag.hand_uid = p.hand_uid
where {{ dirty_partitions('p.played_at_utc') }}
