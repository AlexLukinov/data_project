-- `decisions.made_hand` must be filled on every postflop decision whose hole cards are known,
-- empty everywhere else, and never a value outside the vocabulary (plan E.5, F-902).
--
-- This is the acceptance clause of the step, kept as a standing assertion. It catches the
-- failure mode the step was most exposed to: `made_hand` is written at parse time and reaches
-- the mart through a rebuild, so a partition that was never rebuilt keeps the column's empty
-- default and looks exactly like "the cards were not shown". Nothing else in the chain would
-- notice, and every distribution the pool reports would quietly be built on a subset.
--
-- Three ways to be wrong, one query:
--   missing  -- postflop, cards known, class empty        (the rebuild gap above)
--   spurious -- preflop or no cards, yet a class is set   (a street or a seat misaligned)
--   unknown  -- a value that is not one of the seventeen  (a drifted vocabulary)
--
-- **Unsampled on purpose.** It is a streaming single-table scan of three small columns with no
-- join and no aggregation, so 73.7M rows cost no more memory than 73.7k and the strongest form
-- is also the affordable one. If it ever does need a bound, bound it on
-- `cityHash64(hand_uid) % N` as assert_invested_bb_is_the_seats_own_chips.sql does -- never on
-- the calendar: a day-of-month sample once covered 4 months of 10 and missed both hero months,
-- which is precisely how an empty column survives a release.

{% set classes = "'straight_flush','quads','full_house','flush','straight','set','trips',"
                 "'two_pair','overpair','top_pair','under_pair','second_pair','third_pair',"
                 "'weak_pair','ace_high','king_high','no_pair'" %}

-- Scoped to hold'em, which is the whole corpus today (73,679,949 of 73,679,949 decisions) but
-- need not stay so. The seventeen classes describe two hole cards against a board; a four-card
-- Omaha holding has cards and no such class, and `core.classify` returns '' for it rather than
-- a wrong answer. Without this clause, importing one PLO hand would turn a correct empty value
-- into a failing assertion.

-- "Has cards" means TWO cards, which is not pedantry: exactly one seat in the 54.5M-row corpus
-- showed a single card at showdown (`Kh`, an anonymised opponent on a real GGPoker hand). A
-- one-card holding has no made-hand class — the class is defined for two hole cards against a
-- board — so `core.classify` returns '' for it, correctly. Counting that as "missing" would
-- make this assertion permanently red over one genuine row of data.

{% set two_cards = "length(splitByChar(' ', hole_cards)) = 2" %}

select
    hand_uid,
    seat,
    action_index,
    street,
    hole_cards,
    made_hand,
    multiIf(
        street != 'preflop' and {{ two_cards }} and made_hand = '', 'missing',
        (street = 'preflop' or hole_cards = '') and made_hand != '', 'spurious',
        'unknown_class'
    ) as problem
from {{ ref('decisions') }}
where game_type = 'holdem'
  and ((street != 'preflop' and {{ two_cards }} and made_hand = '')
       or ((street = 'preflop' or hole_cards = '') and made_hand != '')
       or (made_hand != '' and made_hand not in ({{ classes }})))
