-- 0013: `hand_uid` as FixedString(16) in core.* (plan B.5b).
--
-- The 32-character hex form was 51% of the v1 fact table and does not compress -- it is a
-- digest. Sixteen raw bytes halve it: measured on the real corpus, the column fell from
-- 2.23 GiB to 0.78 GiB across the four tables (31.1 -> 16.0 bytes per row on core.hands).
--
-- `hand_uid` leads every core sort key, so this is a TABLE REBUILD, not an ALTER (ADR-017):
-- build the new table, copy into it, swap the names, drop the old one.
--
-- **The one migration in this directory that is not re-runnable**, and the exception is
-- structural rather than an oversight: after it has run `hand_uid` is already FixedString(16),
-- and `unhex()` over 16 raw bytes is not an error, it is silent nonsense. The runner never
-- re-applies an applied version (`ch/migrate.py`), which is what makes that safe.
--
-- **On a database that already holds a corpus, do NOT apply this file.** The INSERTs below
-- copy whole tables in one statement, which is exactly the one-shot ADR-019 exists to forbid
-- on a 4 GB node. Use `scripts/rebuild_core_uid.py`, which does the same rebuild a partition
-- at a time and refuses to swap until the copy is proved identical, then record this version by
-- inserting ('0013', 'hand_uid_fixedstring') into _meta.schema_migrations. That is how it was
-- applied to the founder's 9.1M-hand database on 2026-09-21.
-- (No semicolon anywhere in this header: the runner splits statements on one, comment or not.)

CREATE TABLE IF NOT EXISTS core.hands__v2
(
    `user_id` UInt32,
    `dataset` LowCardinality(String) DEFAULT 'hero',
    `hand_uid` FixedString(16),
    `site` LowCardinality(String),
    `site_hand_id` String,
    `played_at_utc` DateTime64(3, 'UTC'),
    `game_type` LowCardinality(String),
    `limit_type` LowCardinality(String),
    `table_format` LowCardinality(String),
    `currency` LowCardinality(String),
    `small_blind` Decimal(18, 4),
    `big_blind` Decimal(18, 4),
    `ante` Decimal(18, 4),
    `straddle` Decimal(18, 4),
    `stake_level` LowCardinality(String),
    `hole_card_count` UInt8,
    `max_seats` UInt8,
    `players_dealt_in` UInt8,
    `button_seat` UInt8,
    `table_name` String,
    `board_flop_1` LowCardinality(String),
    `board_flop_2` LowCardinality(String),
    `board_flop_3` LowCardinality(String),
    `board_turn` LowCardinality(String),
    `board_river` LowCardinality(String),
    `total_pot` Decimal(18, 4),
    `rake` Decimal(18, 4),
    `hero_seat` Nullable(UInt8),
    `tournament_id` Nullable(String),
    `tz_source` LowCardinality(String),
    `raw_object_key` String,
    `raw_byte_offset` UInt64,
    `parser_version` UInt32,
    `parsed_at` DateTime64(3, 'UTC') DEFAULT now64(3),
    `game_structure` LowCardinality(String) DEFAULT 'flop',
    `is_hi_lo` UInt8 DEFAULT 0,
    `tourney_kind` LowCardinality(String) DEFAULT 'none',
    `tourney_speed` LowCardinality(String) DEFAULT 'none',
    `tourney_buy_in` Decimal(18, 4) DEFAULT 0,
    `tourney_bounty` Decimal(18, 4) DEFAULT 0,
    `tourney_fee` Decimal(18, 4) DEFAULT 0,
    `tourney_currency` LowCardinality(String) DEFAULT '',
    `tourney_level` LowCardinality(String) DEFAULT '',
    `is_big_blind_ante` UInt8 DEFAULT 0,
    `is_satellite` UInt8 DEFAULT 0,
    `players_remaining` Nullable(UInt32),
    `entrants` Nullable(UInt32),
    `schema_version` UInt16 DEFAULT 1,
    `format_signature` LowCardinality(String) DEFAULT '',
    `unparsed_count` UInt16 DEFAULT 0,
    `unparsed_lines` Array(String) DEFAULT [],
    `extra` Map(String, String) DEFAULT map(),
    `jackpot_drop` Decimal(18, 4) DEFAULT 0,
    `cash_drop` Decimal(18, 4) DEFAULT 0
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid)
SETTINGS index_granularity = 8192
;
INSERT INTO core.hands__v2 SELECT * REPLACE (toFixedString(unhex(hand_uid), 16) AS hand_uid) FROM core.hands;
EXCHANGE TABLES core.hands AND core.hands__v2;
DROP TABLE core.hands__v2;

CREATE TABLE IF NOT EXISTS core.hand_players__v2
(
    `user_id` UInt32,
    `dataset` LowCardinality(String) DEFAULT 'hero',
    `hand_uid` FixedString(16),
    `played_at_utc` DateTime64(3, 'UTC'),
    `seat` UInt8,
    `player_key` Nullable(String),
    `screen_name` String,
    `is_hero` UInt8,
    `is_anonymized` UInt8,
    `anon_alias` String,
    `position` LowCardinality(String),
    `position_index` UInt8,
    `starting_stack` Decimal(18, 4),
    `starting_stack_bb` Decimal(12, 2),
    `hole_cards` String,
    `total_invested` Decimal(18, 4),
    `net_won` Decimal(18, 4),
    `net_won_bb` Decimal(18, 4),
    `allin_equity` Nullable(Decimal(9, 6)),
    `ev_won_bb` Nullable(Decimal(18, 4)),
    `saw_flop` UInt8,
    `saw_turn` UInt8,
    `saw_river` UInt8,
    `went_to_showdown` UInt8,
    `won_hand` UInt8,
    `parsed_at` DateTime64(3, 'UTC') DEFAULT now64(3),
    `bounty_won` Decimal(18, 4) DEFAULT 0,
    `was_eliminated` UInt8 DEFAULT 0,
    `finish_position` Nullable(UInt32),
    `extra` Map(String, String) DEFAULT map(),
    `made_hand_flop` LowCardinality(String) DEFAULT '',
    `made_hand_turn` LowCardinality(String) DEFAULT '',
    `made_hand_river` LowCardinality(String) DEFAULT ''
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid, seat)
SETTINGS index_granularity = 8192
;
INSERT INTO core.hand_players__v2 SELECT * REPLACE (toFixedString(unhex(hand_uid), 16) AS hand_uid) FROM core.hand_players;
EXCHANGE TABLES core.hand_players AND core.hand_players__v2;
DROP TABLE core.hand_players__v2;

CREATE TABLE IF NOT EXISTS core.actions__v2
(
    `user_id` UInt32,
    `dataset` LowCardinality(String) DEFAULT 'hero',
    `hand_uid` FixedString(16),
    `played_at_utc` DateTime64(3, 'UTC'),
    `action_index` UInt16,
    `street` Enum8('preflop' = 0, 'flop' = 1, 'turn' = 2, 'river' = 3, 'showdown' = 4),
    `seat` UInt8,
    `action_type` Enum8('post_sb' = 0, 'post_bb' = 1, 'post_ante' = 2, 'post_straddle' = 3, 'post_dead' = 4, 'fold' = 5, 'check' = 6, 'call' = 7, 'bet' = 8, 'raise' = 9, 'allin' = 10, 'show' = 11, 'muck' = 12, 'uncalled_return' = 13, 'win' = 14),
    `amount` Decimal(18, 4),
    `amount_to` Decimal(18, 4),
    `pot_before` Decimal(18, 4),
    `to_call` Decimal(18, 4),
    `is_allin` UInt8,
    `is_voluntary` UInt8,
    `parsed_at` DateTime64(3, 'UTC') DEFAULT now64(3),
    `cards_revealed` String DEFAULT ''
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid, action_index)
SETTINGS index_granularity = 8192
;
INSERT INTO core.actions__v2 SELECT * REPLACE (toFixedString(unhex(hand_uid), 16) AS hand_uid) FROM core.actions;
EXCHANGE TABLES core.actions AND core.actions__v2;
DROP TABLE core.actions__v2;

CREATE TABLE IF NOT EXISTS core.pot_winners__v2
(
    `user_id` UInt32,
    `dataset` LowCardinality(String) DEFAULT 'hero',
    `hand_uid` FixedString(16),
    `played_at_utc` DateTime64(3, 'UTC'),
    `pot_index` UInt8,
    `seat` UInt8,
    `amount_won` Decimal(18, 4),
    `parsed_at` DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid, pot_index, seat)
SETTINGS index_granularity = 8192
;
INSERT INTO core.pot_winners__v2 SELECT * REPLACE (toFixedString(unhex(hand_uid), 16) AS hand_uid) FROM core.pot_winners;
EXCHANGE TABLES core.pot_winners AND core.pot_winners__v2;
DROP TABLE core.pot_winners__v2;
