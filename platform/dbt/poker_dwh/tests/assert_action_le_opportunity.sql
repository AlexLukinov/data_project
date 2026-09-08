-- LAW OF ARITHMETIC: an action can never be counted more often than the opportunity that
-- allowed it. Every stat in the product is action/opportunity, so any violation here means
-- some stat can exceed 100% — and a HUD showing "3-bet: 140%" is the tell that the
-- opportunity condition is wrong, not the action condition.
--
-- Checked for every stat pair in one query. Adding a stat means adding a line here.

with totals as (
    select
        user_id,
        sum(vpip_action)          as vpip_a,          sum(vpip_opp)          as vpip_o,
        sum(pfr_action)           as pfr_a,           sum(pfr_opp)           as pfr_o,
        sum(threebet_action)      as tb_a,            sum(threebet_opp)      as tb_o,
        sum(fold_to_3bet_action)  as f3_a,            sum(fold_to_3bet_opp)  as f3_o,
        sum(fourbet_action)       as fb_a,            sum(fourbet_opp)       as fb_o,
        sum(steal_action)         as st_a,            sum(steal_opp)         as st_o,
        sum(fold_bb_steal_action) as fbb_a,           sum(fold_bb_steal_opp) as fbb_o,
        sum(cbet_flop_action)     as cf_a,            sum(cbet_flop_opp)     as cf_o,
        sum(cbet_turn_action)     as ct_a,            sum(cbet_turn_opp)     as ct_o,
        sum(fold_to_cbet_f_action) as fcf_a,          sum(fold_to_cbet_f_opp) as fcf_o,
        sum(checkraise_f_action)  as cr_a,            sum(checkraise_f_opp)  as cr_o,
        sum(wwsf_action)          as ww_a,            sum(wwsf_opp)          as ww_o,
        sum(wtsd_action)          as wt_a,            sum(wtsd_opp)          as wt_o,
        sum(wsd_action)           as ws_a,            sum(wsd_opp)           as ws_o
    from {{ ref('stats_daily') }}
    group by user_id
)

select * from totals
where vpip_a > vpip_o
   or pfr_a  > pfr_o
   or tb_a   > tb_o
   or f3_a   > f3_o
   or fb_a   > fb_o
   or st_a   > st_o
   or fbb_a  > fbb_o
   or cf_a   > cf_o
   or ct_a   > ct_o
   or fcf_a  > fcf_o
   or cr_a   > cr_o
   or ww_a   > ww_o
   or wt_a   > wt_o
   or ws_a   > ws_o
