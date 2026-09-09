-- Separate hands the user PLAYED from hands the user merely OBSERVED.
--
-- Two genuinely different kinds of data now land in the same tenant:
--
--   dataset = 'hero'        the user's own export. A `Hero` seat exists, hole cards are
--                           known, opponents are GG-anonymized session aliases.
--   dataset = 'population'  observed pool hands. NO hero seat at all, real screen names,
--                           hole cards only at showdown (~13% of hands).
--
-- Why this must be an explicit column rather than `hero_seat IS NULL`:
--
--   1. **It is a correctness boundary, not a convenience.** Averaging bb/100 over 9.1M hands
--      the user never played is not a slightly-wrong number, it is a meaningless one. An
--      implicit rule invites exactly one forgotten WHERE clause to produce it silently.
--   2. `hero_seat IS NULL` also matches a hero export whose hero seat failed to resolve --
--      a parser bug -- and would quietly reclassify the user's own hands as pool data.
--   3. Population hands are the intended input to F-601 population analysis, so this is a
--      dimension queries will select ON, not just filter out.
--
-- DEFAULT 'hero' is deliberate: every row that existed before this migration came from a
-- user upload, so the default reclassifies nothing.
--
-- Not added to ORDER BY: the sort key of an existing MergeTree cannot be changed, and the
-- downstream marts (which is where stat queries actually land) do put `dataset` in their
-- sort key. Pruning happens where it pays.

ALTER TABLE core.hands
    ADD COLUMN IF NOT EXISTS dataset LowCardinality(String) DEFAULT 'hero' AFTER user_id;

-- Denormalized onto the player grain too. int_hand_player_flags already inner-joins
-- core.hands so dbt does not need it -- but ad-hoc ClickHouse queries against
-- core.hand_players are a first-class use case (that is the whole point of keeping the raw
-- grain queryable), and forcing every one of them through a 55M-row join to answer
-- "pool only" would make the obvious query the slow one.
ALTER TABLE core.hand_players
    ADD COLUMN IF NOT EXISTS dataset LowCardinality(String) DEFAULT 'hero' AFTER user_id;
