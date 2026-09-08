-- Promotional pot deductions that are NOT rake.
--
-- Found by running the parser against a real 147k-hand GGPoker export: 8% of hands failed
-- pot-math reconciliation even after the rake bug was fixed, all of them off by exactly the
-- `Jackpot` amount. GG's summary line prints FOUR such deductions:
--
--   Total pot $5.86 | Rake $0.28 | Jackpot $0.15 | Bingo $0 | Fortune $0 | Tax $0
--
-- and the pot only balances as:
--   contributed - uncalled_returns == awarded + rake + drops
--
-- Worth its own column rather than folding into `rake`: a player's true win rate depends on
-- what they paid the house, and a jackpot drop is a lottery ticket rather than a fee for the
-- service. Merging them would quietly overstate rake in every rake-adjusted statistic.

ALTER TABLE core.hands
    ADD COLUMN IF NOT EXISTS jackpot_drop Decimal(18, 4) DEFAULT 0;
