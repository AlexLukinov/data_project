-- Per hand, `sum(ev_won_bb)` must equal `sum(net_won_bb)` (plan E.5, ADR-018).
--
-- This is the invariant that makes an EV-adjusted win rate comparable with the real one. The
-- all-in adjustment does not invent money from equities: it takes the pot that was actually
-- awarded and hands it out by each contender's expected share of each side-pot layer, so the
-- hand still balances to the cent. Rake, jackpot drops and cash drops therefore need no
-- special treatment here -- they are already inside the awarded total before it is shared.
--
-- What it catches is the whole class of errors that would otherwise be invisible, because a
-- plausible-looking EV number is indistinguishable from a correct one by eye:
--   * equity assigned to the wrong seat (the killer -- the numbers all still look sane);
--   * a side pot awarded to a player who could not cover it, which inflates the short stack's
--     EV and deflates everyone else's by the same amount;
--   * an EV written for some contenders of a hand but not others, which is what a partial
--     backfill looks like.
-- A per-player test could not catch any of them; only the per-hand sum can.
--
-- The tolerance is rounding, not slack: `ev_won_bb` and `net_won_bb` are each quantized to four
-- decimal places per seat, so a nine-handed pot can legitimately drift a few ten-thousandths.
-- 0.005 bb is an order of magnitude above that and orders of magnitude below any real error.
--
-- **One hand in 64**, on `cityHash64(hand_uid)` rather than on the calendar: this one does
-- aggregate (9M groups over 54.5M rows unbounded), which is a MEMORY_LIMIT_EXCEEDED on the
-- 3.6 GiB node rather than a failing assertion. Hash sampling keeps every month in scope --
-- including both hero months, which a day-of-month sample missed entirely on 2026-09-11 and
-- which are the only months where anyone reads this number. Set `ev_sum_sample_mod` to 1 to
-- test the lot, with `DBT_CH_MAX_MEMORY` raised to match.

{% set sample_mod = var('ev_sum_sample_mod', 64) %}

select
    hand_uid,
    sum(ev_won_bb)  as ev_total,
    sum(net_won_bb) as net_total,
    sum(ev_won_bb) - sum(net_won_bb) as drift,
    count() as seats
from {{ ref('player_hands') }}
{% if sample_mod > 1 %}
where cityHash64(hand_uid) % {{ sample_mod }} = 0
{% endif %}
group by hand_uid
having abs(sum(ev_won_bb) - sum(net_won_bb)) > 0.005
