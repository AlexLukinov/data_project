-- House-added money: GG's Cash Drop promotion.
--
-- `Cash Drop to Pot : total $2.50` adds money to the pot that no player contributed. It is
-- the only amount in a hand history that moves in the opposite direction to everything else,
-- and until it was parsed the reconciliation `contributed - returned == awarded + rake` was
-- simply false on every hand carrying one. The validator did its job and rejected them, which
-- cost 0.6% of a real 9M-hand corpus (56,872 hands) — all of them otherwise perfectly valid.
--
-- Deliberately NOT folded into `jackpot_drop`. That column means "money the house took out",
-- whereas this is money the house put in. Sharing a column would make `rake + jackpot_drop`
-- stop summing to what the house earned, and that expression is what every rake-adjusted stat
-- is built on.
--
-- (Note for future migrations: the statement splitter in ch/migrate.py cuts on a semicolon at
-- end of line, comments included. A comment ending in one produces an empty statement and a
-- SYNTAX_ERROR. Keep semicolons out of the last column of a comment line.)
--
-- It IS won money — the winner really does collect it — so it needs no special handling in
-- net_won or in win-rate. Only the reconciliation had to learn about it.

ALTER TABLE core.hands
    ADD COLUMN IF NOT EXISTS cash_drop Decimal(18, 4) DEFAULT 0 AFTER jackpot_drop;
