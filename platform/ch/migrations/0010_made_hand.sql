-- The made-hand class each seat held on each street (plan E.5, F-902).
--
-- Three columns rather than one: the class a decision is taken with is the class for the
-- street it is taken on, and `marts.decisions` knows its own street, so `decision_state()`
-- picks the matching one. A single column would have had to mean "at the end", which is the
-- wrong answer at every decision before it.
--
-- `LowCardinality(String)` because there are seventeen possible values (core/classify.py) plus
-- the empty string. Empty is not one of the classes and is not a default to be repaired later:
-- it means the cards or the board were not known, which is the truth for every seat that never
-- showed and for every hand that ended preflop. "Not shown" must never read as "no pair".
--
-- No `UPDATE` backfill here, deliberately. Unlike 0009's `dataset`, there is no existing
-- column that already knows the answer -- it takes a hand evaluator over the stored cards --
-- so the corpus is filled by `uv run python -m scripts.backfill_equity`, which is resumable
-- and reports what it wrote. Rows written before that runs read the empty string, which is
-- exactly what an unknown holding reads anyway.

ALTER TABLE core.hand_players
    ADD COLUMN IF NOT EXISTS made_hand_flop LowCardinality(String) DEFAULT '' AFTER extra;

ALTER TABLE core.hand_players
    ADD COLUMN IF NOT EXISTS made_hand_turn LowCardinality(String) DEFAULT '' AFTER made_hand_flop;

ALTER TABLE core.hand_players
    ADD COLUMN IF NOT EXISTS made_hand_river LowCardinality(String) DEFAULT '' AFTER made_hand_turn;
