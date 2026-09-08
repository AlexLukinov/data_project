-- Seams: created empty in Phase 1, populated years later.
--
-- Why now? Because the alternative is a full reprocess of every hand later. An unjoined
-- column and an empty table cost nothing; retrofitting a join key costs everything.
--
-- See docs/POKER_DECISIONS.md ADR-011 (solver seam) and ADR-014 (ingestion contract).

-- --------------------------------------------------------------------------------------
-- Solver / baselines seam.
--
-- The join key is `spot_key` -- a deterministic hash of (game, stakes bucket, positions,
-- stack depth, preflop action sequence, street, board texture); see core/ids.py:spot_key.
--
-- Any producer writes this same shape:
--   * a CFR solver (TexasSolver) run as a queued compute service   -- Future, F-904
--   * purchased solver output                                       -- Future, F-905
--   * POPULATION baselines derived from our own hands               -- Differentiator, F-601
--
-- That last one is the important one: population baselines need no solver at all, ship in
-- Phase 2, and validate this seam years before any solver exists.
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marts.baseline_strategies
(
    baseline_set_id  UUID,
    spot_key         String,
    action           LowCardinality(String),   -- fold / check / call / bet_33 / raise_75 / ...
    frequency        Decimal(9, 6),            -- 0..1
    ev               Decimal(18, 6),           -- in big blinds
    sample_size      UInt64,                   -- 0 for solver output; >0 for population
    created_at       DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (baseline_set_id, spot_key, action);

-- --------------------------------------------------------------------------------------
-- Dead letters. NOT an error log -- this is the parser bug backlog, and every row carries a
-- reproducible input. A parser bug you cannot reproduce is a parser bug you cannot fix.
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.parse_failures
(
    user_id         UInt32,
    upload_id       UUID,
    site            LowCardinality(String),
    raw_object_key  String,
    raw_byte_offset UInt64,
    hand_excerpt    String,                    -- first ~2 KB, enough to reproduce
    error_code      LowCardinality(String),
    error_message   String,
    parser_version  UInt32,
    failed_at       DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(failed_at)
ORDER BY (user_id, failed_at, error_code);
