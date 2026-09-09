-- LAW OF ARITHMETIC: an action can never be counted more often than the opportunity that
-- allowed it. Every stat in the product is action/opportunity, so any violation here means
-- some stat can exceed 100% — and a HUD showing "3-bet: 140%" is the tell that the
-- opportunity condition is wrong, not the action condition.
--
-- Checked for EVERY stat pair in one query, per tenant and dataset. Adding a stat means adding
-- its (action, opportunity) tuple below; tests/test_stat_vocabulary.py fails the build if a
-- ratio stat in api/queries.py has no tuple here. (POKER_PLAN.md phase C generates this file
-- from the stat registry; until then it is maintained by hand.)

{% set pairs = [
    ('vpip_action', 'vpip_opp'),
    ('pfr_action', 'pfr_opp'),
    ('threebet_action', 'threebet_opp'),
    ('fold_to_3bet_action', 'fold_to_3bet_opp'),
    ('fourbet_action', 'fourbet_opp'),
    ('steal_action', 'steal_opp'),
    ('fold_bb_steal_action', 'fold_bb_steal_opp'),
    ('cbet_flop_action', 'cbet_flop_opp'),
    ('cbet_turn_action', 'cbet_turn_opp'),
    ('fold_to_cbet_f_action', 'fold_to_cbet_f_opp'),
    ('checkraise_f_action', 'checkraise_f_opp'),
    ('wwsf_action', 'wwsf_opp'),
    ('wtsd_action', 'wtsd_opp'),
    ('wsd_action', 'wsd_opp'),
    ('rfi_action', 'rfi_opp'),
    ('limp_action', 'limp_opp'),
    ('iso_action', 'iso_opp'),
    ('cold_call_action', 'cold_call_opp'),
    ('squeeze_action', 'squeeze_opp'),
    ('call_3bet_action', 'call_3bet_opp'),
    ('fivebet_action', 'fivebet_opp'),
    ('fold_to_4bet_action', 'fold_to_4bet_opp'),
    ('vs_open_call', 'vs_open_opp'),
    ('vs_open_fold', 'vs_open_opp'),
    ('vs_4bet_call', 'vs_4bet_opp'),
    ('cbet_river_action', 'cbet_river_opp'),
    ('fold_to_cbet_t_action', 'fold_to_cbet_t_opp'),
    ('fold_to_cbet_r_action', 'fold_to_cbet_r_opp'),
    ('donk_f_action', 'donk_f_opp'),
    ('probe_t_action', 'probe_t_opp'),
    ('delayed_cbet_action', 'delayed_cbet_opp'),
    ('float_action', 'float_opp'),
    ('checkraise_t_action', 'checkraise_t_opp'),
    ('checkraise_r_action', 'checkraise_r_opp'),
    ('saw_river_action', 'saw_river_opp'),
    ('limp_fold_action', 'limp_faced_raise_opp'),
    ('limp_call_action', 'limp_faced_raise_opp'),
    ('limp_raise_action', 'limp_faced_raise_opp'),
    ('raise_cbet_f_action', 'fold_to_cbet_f_opp'),
    ('float_fold_action', 'float_fold_opp'),
    ('fold_to_donk_action', 'fold_to_donk_opp'),
    ('fold_to_flop_raise_action', 'fold_to_flop_raise_opp'),
    ('fold_to_turn_raise_action', 'fold_to_turn_raise_opp'),
    ('fold_to_river_raise_action', 'fold_to_river_raise_opp'),
    ('bet_call_river_action', 'fold_to_river_raise_opp'),
    ('fold_to_probe_t_action', 'fold_to_probe_t_opp'),
    ('fold_to_delayed_cbet_action', 'fold_to_delayed_cbet_opp'),
    ('probe_r_action', 'probe_r_opp'),
    ('fold_to_probe_r_action', 'fold_to_probe_r_opp'),
    ('river_raise_action', 'river_face_bet_opp'),
    ('river_check_fold_action', 'river_check_faced_opp'),
    ('river_check_call_action', 'river_check_faced_opp'),
] %}

with totals as (
    select
        user_id,
        dataset,
        {%- for action, opp in pairs %}
        sum({{ action }}) as {{ action }}__a,
        sum({{ opp }}) as {{ opp }}__o{{ "," if not loop.last }}
        {%- endfor %}
    from {{ ref('stats_daily') }}
    group by user_id, dataset
)

select * from totals
where
    {%- for action, opp in pairs %}
    {{ action }}__a > {{ opp }}__o{{ " or" if not loop.last }}
    {%- endfor %}
