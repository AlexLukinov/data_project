-- `decisions.invested_bb` must equal the seat's own chips already in the pot (plan F.10).
--
-- The column is computed inside macros/decision_state.sql by summing a prefix of the hand's
-- action arrays. This test recomputes it a completely different way -- a window function over
-- stg_actions, no arrays, no macro -- so an error in the array slicing cannot hide behind the
-- same mistake twice. It is the whole basis of empirical EQR: `net_won_bb + invested_bb` is
-- what a seat won from the decision onwards, and a wrong `invested_bb` would move every EQR
-- the pool reports without anything looking broken.
--
-- Only the actions that move chips are summed, which is the same set hand_arrays.sql keeps:
-- an uncalled return is not among them, so nothing has to be subtracted back out.
--
-- **It samples one hand in 64, and that is deliberate.** Unbounded, this test window-sorts
-- ~100M stg_actions rows by (hand_uid, seat) and joins 73.7M decisions against the result; on
-- the 3.6 GiB node that is not a failing assertion but a MEMORY_LIMIT_EXCEEDED, which is a
-- worse outcome than no test at all -- it reports red without ever comparing a row. The thing
-- being tested is one shared array-slicing expression in a macro, so an error in it is
-- systematic, not per-row: it shows up in any representative slice.
--
-- The sample is taken on `cityHash64` of the 16 raw `hand_uid` bytes, which is why the two
-- sides can filter independently and still select the same hands: `stg_actions` stores the uid
-- as hex and `decisions` as FixedString(16), and cityHash64 over `unhex(...)` equals cityHash64
-- over the FixedString of the same bytes. Sampling on the hand rather than on the calendar is
-- what keeps **every** month in scope -- an earlier day-of-month sample silently covered 4
-- months of 10 and missed both hero months entirely, because sparse months have no such day.
-- Set `invested_bb_sample_mod` to 1 to test everything, with `DBT_CH_MAX_MEMORY` raised to match.

{% set sample_mod = var('invested_bb_sample_mod', 64) %}

with expected as (

    select
        toFixedString(unhex(hand_uid), 16) as hand_uid,
        seat,
        action_index,
        sum(amount) over (
            partition by hand_uid, seat
            order by action_index
            rows between unbounded preceding and 1 preceding
        ) as prior_amount
    from {{ ref('stg_actions') }}
    where action_type in ('post_sb', 'post_bb', 'post_ante', 'post_straddle', 'post_dead',
                          'fold', 'check', 'call', 'bet', 'raise')
    {% if sample_mod > 1 %}
      and cityHash64(unhex(hand_uid)) % {{ sample_mod }} = 0
    {% endif %}

)

select
    d.hand_uid    as hand_uid,
    d.seat        as seat,
    d.invested_bb as invested_bb,
    toFloat32(toFloat64(e.prior_amount) / toFloat64(d.big_blind)) as expected_bb
from {{ ref('decisions') }} as d
inner join expected as e
    on e.hand_uid = d.hand_uid
   and e.seat = d.seat
   and e.action_index = d.action_index
where abs(d.invested_bb - toFloat64(e.prior_amount) / toFloat64(d.big_blind)) > 0.001
{% if sample_mod > 1 %}
  and cityHash64(d.hand_uid) % {{ sample_mod }} = 0
{% endif %}
