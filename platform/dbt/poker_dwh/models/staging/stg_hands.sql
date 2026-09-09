-- One row per hand.
--
-- `FINAL` is load-bearing, not decoration. core.hands is a ReplacingMergeTree, so after a
-- re-parse there are temporarily TWO physical rows per hand -- the old parser version and the
-- new one -- until a background merge collapses them. Merges are eventual and may never fire
-- for a given pair of parts. Without FINAL, every hand counted twice during that window.

select
    user_id,
    -- 'hero' = hands the user played; 'population' = observed pool hands. Never mix the two
    -- in one average -- see ch/migrations/0007_dataset.sql.
    dataset,
    hand_uid,
    site,
    site_hand_id,
    played_at_utc,
    toDate(played_at_utc)                                as played_date,
    game_type,
    limit_type,
    table_format,
    currency,
    small_blind,
    big_blind,
    stake_level,
    hole_card_count,
    max_seats,
    players_dealt_in,
    button_seat,
    table_name,
    board_flop_1,
    board_flop_2,
    board_flop_3,
    board_turn,
    board_river,
    -- Did the hand reach each street? Derived once here so no downstream model re-derives it.
    -- CAST(... AS UInt8), not toUInt8(...): comparing a LowCardinality(String) column yields
    -- LowCardinality(UInt8), and ClickHouse refuses to materialize that
    -- (SUSPICIOUS_TYPE_FOR_LOW_CARDINALITY -- a two-value dictionary costs more than it
    -- saves). toUInt8() PROPAGATES the LowCardinality wrapper; only CAST strips it.
    cast(board_flop_1 != '' as UInt8)                    as has_flop,
    cast(board_turn   != '' as UInt8)                    as has_turn,
    cast(board_river  != '' as UInt8)                    as has_river,
    total_pot,
    rake,
    hero_seat,
    tournament_id,
    parser_version,
    ante,
    -- Ingestion watermark -- see macros/incremental.sql. This is THE authoritative one: the
    -- dirty-partition subquery reads core.hands.parsed_at, and every other model's watermark
    -- is compared against it.
    parsed_at                                            as src_parsed_at
from {{ source('core', 'hands') }} final
