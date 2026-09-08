-- Core landing tables: what the parser workers write into.
--
-- Two rules govern every table here, and both are expensive to change later:
--
--  1. `user_id` LEADS every ORDER BY. The sort key IS the physical layout in ClickHouse, so a
--     query filtered by user_id binary-searches straight to that tenant's granules. Put
--     anything else first and every dashboard query does a generic exclusion scan across all
--     tenants' data. Changing a sort key is not a migration, it is a full table rebuild.
--
--  2. PARTITION BY toYYYYMM(played_at_utc) -- coarse (dozens of partitions), prunable by every
--     date-ranged query, cheap to drop for retention. Critically, a RE-PARSED hand lands in the
--     SAME partition as the original, because played_at_utc is a property of the hand and not
--     of the parse. That is what makes ReplacingMergeTree dedup actually work: it only
--     collapses rows within a partition.
--
-- ReplacingMergeTree(parsed_at) throughout: re-parsing is a first-class operation. Parser v7
-- fixes a bug, you re-run it, the new rows carry a later parsed_at and supersede the old ones
-- on the next merge. No deletes. Read the deduplicated truth with FINAL.

CREATE DATABASE IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.hands
(
    user_id           UInt32,
    hand_uid          String,
    site              LowCardinality(String),
    site_hand_id      String,
    played_at_utc     DateTime64(3, 'UTC'),
    game_type         LowCardinality(String),
    limit_type        LowCardinality(String),
    table_format      LowCardinality(String),
    currency          LowCardinality(String),
    small_blind       Decimal(18, 4),
    big_blind         Decimal(18, 4),
    ante              Decimal(18, 4),
    straddle          Decimal(18, 4),
    stake_level       LowCardinality(String),
    hole_card_count   UInt8,
    max_seats         UInt8,
    players_dealt_in  UInt8,
    button_seat       UInt8,
    table_name        String,
    board_flop_1      LowCardinality(String),
    board_flop_2      LowCardinality(String),
    board_flop_3      LowCardinality(String),
    board_turn        LowCardinality(String),
    board_river       LowCardinality(String),
    total_pot         Decimal(18, 4),
    rake              Decimal(18, 4),
    hero_seat         Nullable(UInt8),
    tournament_id     Nullable(String),
    tz_source         LowCardinality(String),
    raw_object_key    String,
    raw_byte_offset   UInt64,
    parser_version    UInt32,
    parsed_at         DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid);

CREATE TABLE IF NOT EXISTS core.hand_players
(
    user_id           UInt32,
    hand_uid          String,
    played_at_utc     DateTime64(3, 'UTC'),   -- denormalized so this table partitions the same way
    seat              UInt8,
    player_key        Nullable(String),       -- NULL on anonymized sites; the opponent-stat gate
    screen_name       String,
    is_hero           UInt8,
    is_anonymized     UInt8,
    anon_alias        String,
    position          LowCardinality(String),
    position_index    UInt8,
    starting_stack    Decimal(18, 4),
    starting_stack_bb Decimal(12, 2),
    hole_cards        String,                 -- space-delimited; length varies by variant
    total_invested    Decimal(18, 4),
    net_won           Decimal(18, 4),
    net_won_bb        Decimal(18, 4),
    allin_equity      Nullable(Decimal(9, 6)),
    ev_won_bb         Nullable(Decimal(18, 4)),
    saw_flop          UInt8,
    saw_turn          UInt8,
    saw_river         UInt8,
    went_to_showdown  UInt8,
    won_hand          UInt8,
    parsed_at         DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid, seat);

CREATE TABLE IF NOT EXISTS core.actions
(
    user_id       UInt32,
    hand_uid      String,
    played_at_utc DateTime64(3, 'UTC'),
    action_index  UInt16,                     -- GLOBAL order within the hand, not per-street
    street        Enum8('preflop'=0,'flop'=1,'turn'=2,'river'=3,'showdown'=4),
    seat          UInt8,
    action_type   Enum8('post_sb'=0,'post_bb'=1,'post_ante'=2,'post_straddle'=3,
                        'post_dead'=4,'fold'=5,'check'=6,'call'=7,'bet'=8,
                        'raise'=9,'allin'=10,'show'=11,'muck'=12,
                        'uncalled_return'=13,'win'=14),
    amount        Decimal(18, 4),
    amount_to     Decimal(18, 4),
    pot_before    Decimal(18, 4),
    to_call       Decimal(18, 4),
    is_allin      UInt8,
    is_voluntary  UInt8,                      -- the one flag that makes VPIP correct
    parsed_at     DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid, action_index);

-- Settlement. A single winner column on the hand is wrong the first time three players go
-- all-in with different stacks.
CREATE TABLE IF NOT EXISTS core.pot_winners
(
    user_id       UInt32,
    hand_uid      String,
    played_at_utc DateTime64(3, 'UTC'),
    pot_index     UInt8,                      -- 0 = main pot
    seat          UInt8,
    amount_won    Decimal(18, 4),
    parsed_at     DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(parsed_at)
PARTITION BY toYYYYMM(played_at_utc)
ORDER BY (user_id, hand_uid, pot_index, seat);

CREATE DATABASE IF NOT EXISTS staging;
CREATE DATABASE IF NOT EXISTS intermediate;
CREATE DATABASE IF NOT EXISTS marts;
