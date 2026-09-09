-- `dataset` on the two core tables that lacked it (0007 added it to hands and hand_players
-- only). Every core table now prunes on it, and a query over actions or pot winners no longer
-- needs a join back to hands to tell hero play from observed pool hands.
--
-- `hero` is the default because migration 0007 chose it for the same reason: every row written
-- before the column existed was a browser upload of the user's own history. The loader has
-- written the column explicitly for every row since (core/schema).

ALTER TABLE core.actions
    ADD COLUMN IF NOT EXISTS dataset LowCardinality(String) DEFAULT 'hero' AFTER user_id;

ALTER TABLE core.pot_winners
    ADD COLUMN IF NOT EXISTS dataset LowCardinality(String) DEFAULT 'hero' AFTER user_id;

-- Repair rows written before this column existed. The default is wrong for every action of
-- an observed pool hand, and `hands` already knows which is which. Keyed on the SMALL set --
-- the hero hands (~20k) -- so the IN set is tiny even though the mutation walks ~100M rows.
-- Synchronous, so the migration only reports success once the data is right. A no-op on an
-- empty environment.
ALTER TABLE core.actions
    UPDATE dataset = 'population'
    WHERE dataset = 'hero'
      AND hand_uid NOT IN (SELECT hand_uid FROM core.hands FINAL WHERE dataset = 'hero')
    SETTINGS mutations_sync = 2;

ALTER TABLE core.pot_winners
    UPDATE dataset = 'population'
    WHERE dataset = 'hero'
      AND hand_uid NOT IN (SELECT hand_uid FROM core.hands FINAL WHERE dataset = 'hero')
    SETTINGS mutations_sync = 2;
