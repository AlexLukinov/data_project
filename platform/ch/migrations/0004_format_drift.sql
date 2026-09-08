-- Forward compatibility: surviving a site changing its hand-history format.
--
-- Hand-history formats DO change -- PokerStars has revised theirs, GG changes PokerCraft
-- exports, partypoker has broken parsers with client updates. The question is never "will it
-- change" but "what happens on the day it does". Four mechanisms, in order of importance:
--
--  1. RAW TEXT IS KEPT FOREVER (ADR-010). Everything below is recoverable because the source
--     bytes are still in object storage. This is the one that actually saves you.
--  2. `unparsed_lines` -- lines the parser did not recognize are STORED, never dropped. A
--     format change shows up as a spike here, days before any statistic goes wrong.
--  3. `format_signature` -- a fingerprint of each hand's structural shape. A new signature
--     appearing for a site is the alert:
--         SELECT site, format_signature, count(), min(played_at_utc)
--         FROM core.hands GROUP BY 1,2 ORDER BY 3 DESC
--  4. `extra` (Map) -- recognized-but-unmodelled key/values, round-tripped so a field can be
--     promoted to a real column later WITHOUT re-parsing petabytes of text.
--
-- Plus `schema_version` on every row, so a partially re-parsed table stays interpretable and
-- a targeted re-parse is `WHERE schema_version < n`.
--
-- THE SCHEMA EVOLUTION RULES (follow these and migrations stay boring):
--   * Columns are ADDITIVE with defaults. `ADD COLUMN IF NOT EXISTS` is metadata-only in
--     ClickHouse -- it does not rewrite existing parts.
--   * NEVER reuse a column name for a different meaning. Add `foo_v2`, backfill, drop later.
--   * NEVER change a sort key. That is a table rebuild, not a migration -- which is why
--     `user_id` had to lead from migration 0001.
--   * A change to what a field MEANS bumps `schema_version` and needs a re-parse.

ALTER TABLE core.hands
    ADD COLUMN IF NOT EXISTS schema_version    UInt16 DEFAULT 1,
    ADD COLUMN IF NOT EXISTS format_signature  LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS unparsed_count    UInt16 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unparsed_lines    Array(String) DEFAULT [],
    ADD COLUMN IF NOT EXISTS extra             Map(String, String) DEFAULT map();

ALTER TABLE core.hand_players
    ADD COLUMN IF NOT EXISTS extra             Map(String, String) DEFAULT map();

-- Format-drift watch. One row per (site, signature) with first/last seen: a new row here is
-- the signal to look at a sample before stats start moving.
CREATE VIEW IF NOT EXISTS core.v_format_drift AS
SELECT
    site,
    format_signature,
    parser_version,
    count()                 AS hands,
    min(played_at_utc)      AS first_seen,
    max(played_at_utc)      AS last_seen,
    sum(unparsed_count)     AS unparsed_lines_total
FROM core.hands
GROUP BY site, format_signature, parser_version;
