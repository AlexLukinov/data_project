{{ config(materialized='table', engine='MergeTree()', order_by='code') }}

-- Stat definitions as data, not as code comments.
--
-- The API, the dashboard and (later) the LLM coaching prompt all need to know what "WWSF"
-- means and whether higher is better. Without this table there are three copies of that
-- knowledge and they drift. No incumbent tracker exposes this; it costs one small table.

select * from (
    select 'vpip'              as code, 'VPIP'                as label, 'preflop'  as category,
           'Voluntarily put money in the pot preflop (blinds excluded)' as definition,
           0 as higher_is_better, 18.0 as typical_low, 28.0 as typical_high
    union all select 'pfr', 'PFR', 'preflop',
           'Raised preflop at any point', 0, 14.0, 24.0
    union all select 'threebet', '3-Bet%', 'preflop',
           'Re-raised when facing exactly one raise', 0, 5.0, 11.0
    union all select 'fold_to_3bet', 'Fold to 3-Bet', 'preflop',
           'Folded after open-raising and facing a re-raise', 0, 40.0, 60.0
    union all select 'fourbet', '4-Bet%', 'preflop',
           'Re-raised when facing two raises', 0, 2.0, 8.0
    union all select 'steal', 'Steal%', 'preflop',
           'Raised first-in from CO, BTN or SB', 0, 25.0, 45.0
    union all select 'fold_bb_to_steal', 'Fold BB to Steal', 'preflop',
           'Folded the big blind facing a late-position first-in raise', 0, 45.0, 70.0
    union all select 'cbet_flop', 'C-Bet Flop', 'postflop',
           'Bet the flop as the preflop aggressor', 0, 50.0, 75.0
    union all select 'cbet_turn', 'C-Bet Turn', 'postflop',
           'Bet the turn after c-betting the flop and being called', 0, 40.0, 65.0
    union all select 'fold_to_cbet_flop', 'Fold to C-Bet Flop', 'postflop',
           'Folded facing the preflop aggressor''s flop bet', 0, 40.0, 55.0
    union all select 'check_raise_flop', 'Check-Raise Flop', 'postflop',
           'Raised the flop after checking and facing a bet', 0, 6.0, 14.0
    -- ---- added with the wide-flag expansion ------------------------------------------
    union all select 'rfi', 'RFI (Open%)', 'preflop',
           'Raised when first in, from any position', 0, 15.0, 50.0
    union all select 'limp', 'Limp%', 'preflop',
           'Called the big blind when first in rather than raising', 0, 0.0, 5.0
    union all select 'iso_raise', 'Isolation Raise%', 'preflop',
           'Raised over one or more limpers', 0, 30.0, 60.0
    union all select 'cold_call', 'Cold Call%', 'preflop',
           'Called a raise without already being invested as a blind', 0, 3.0, 10.0
    union all select 'squeeze', 'Squeeze%', 'preflop',
           'Re-raised facing a raise plus at least one cold caller', 0, 4.0, 12.0
    union all select 'call_3bet', 'Call 3-Bet%', 'preflop',
           'Called after open-raising and facing a re-raise', 0, 30.0, 50.0
    union all select 'fivebet', '5-Bet%', 'preflop',
           'Re-raised when facing three raises', 0, 1.0, 6.0
    union all select 'fold_to_4bet', 'Fold to 4-Bet', 'preflop',
           'Folded after 3-betting and facing a 4-bet', 0, 40.0, 65.0
    union all select 'cbet_river', 'C-Bet River', 'postflop',
           'Bet the river after barrelling the turn (triple barrel)', 0, 30.0, 55.0
    union all select 'fold_to_cbet_turn', 'Fold to C-Bet Turn', 'postflop',
           'Folded facing the aggressor''s turn bet', 0, 40.0, 60.0
    union all select 'fold_to_cbet_river', 'Fold to C-Bet River', 'postflop',
           'Folded facing the aggressor''s river bet', 0, 40.0, 65.0
    union all select 'donk_flop', 'Donk Bet Flop', 'postflop',
           'Led into the preflop aggressor on the flop out of position', 0, 0.0, 6.0
    union all select 'probe_turn', 'Probe Turn', 'postflop',
           'Bet the turn out of position after the aggressor checked the flop', 0, 25.0, 50.0
    union all select 'delayed_cbet', 'Delayed C-Bet', 'postflop',
           'Bet the turn as aggressor after checking back the flop', 0, 30.0, 55.0
    union all select 'float_flop', 'Float Flop', 'postflop',
           'Bet the turn after calling a flop bet in position', 0, 20.0, 45.0
    union all select 'check_raise_turn', 'Check-Raise Turn', 'postflop',
           'Raised the turn after checking and facing a bet', 0, 5.0, 14.0
    union all select 'check_raise_river', 'Check-Raise River', 'postflop',
           'Raised the river after checking and facing a bet', 0, 3.0, 10.0
    union all select 'wwsf', 'WWSF', 'showdown',
           'Won the pot, given the flop was seen', 1, 43.0, 52.0
    union all select 'wtsd', 'WTSD', 'showdown',
           'Reached showdown, given the flop was seen', 0, 24.0, 30.0
    union all select 'wsd', 'W$SD', 'showdown',
           'Won at showdown, given showdown was reached', 1, 48.0, 56.0
    union all select 'bb_per_100', 'bb/100', 'money',
           'Big blinds won per 100 hands', 1, 0.0, 10.0
    union all select 'ev_bb_per_100', 'EV bb/100', 'money',
           'All-in-adjusted big blinds won per 100 hands', 1, 0.0, 10.0
)
