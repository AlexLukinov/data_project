-- Full format coverage: heads-up through 10-max, every tournament structure, every variant.
--
-- A separate migration rather than an edit to 0001, because migrations are append-only and
-- forward-only (ADR-017). This is also the demonstration of why `ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS` matters: re-running is harmless, and ClickHouse adds a column as a cheap
-- metadata operation -- it does NOT rewrite the existing parts.
--
-- What this makes possible that 0001 did not:
--   * bounty / PKO analysis   -- bounty, kind, bounties_won
--   * speed-segmented stats   -- a hyper-turbo and a slow MTT are different populations
--   * satellite ICM           -- payouts are seats, not money, near the bubble
--   * stud and draw games     -- game_structure, so nothing assumes a community board
--   * Spin & Go               -- table_format already carries it; entry cost groups it
--
-- `game_structure` is the important one. Branching downstream on "is this a flop game"
-- rather than on a list of variant names is what keeps adding Badugi from being a rewrite.

ALTER TABLE core.hands
    ADD COLUMN IF NOT EXISTS game_structure    LowCardinality(String) DEFAULT 'flop',
    ADD COLUMN IF NOT EXISTS is_hi_lo          UInt8 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tournament_id     String DEFAULT '',
    ADD COLUMN IF NOT EXISTS tourney_kind      LowCardinality(String) DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS tourney_speed     LowCardinality(String) DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS tourney_buy_in    Decimal(18, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tourney_bounty    Decimal(18, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tourney_fee       Decimal(18, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tourney_currency  LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS tourney_level     LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_big_blind_ante UInt8 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_satellite      UInt8 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS players_remaining Nullable(UInt32),
    ADD COLUMN IF NOT EXISTS entrants          Nullable(UInt32);

-- Per-seat bounty results. A knockout is won by a PLAYER in a HAND, so it belongs here and
-- not on the tournament: in a progressive KO the same hand can move bounty value to several
-- stacks at once.
ALTER TABLE core.hand_players
    ADD COLUMN IF NOT EXISTS bounty_won        Decimal(18, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS was_eliminated    UInt8 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS finish_position   Nullable(UInt32);

-- Stud and draw games have no community board but DO have per-street exposed/drawn cards.
-- One nullable column beats a second table nobody reads for flop games.
ALTER TABLE core.actions
    ADD COLUMN IF NOT EXISTS cards_revealed    String DEFAULT '';
