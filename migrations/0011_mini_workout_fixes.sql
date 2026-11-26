-- Follow-ups to 0010_mini_workouts.sql.

-- A nudge is answered by one set at most, however many devices answer it. Where one was answered
-- more than once, the first set keeps answering it; the others stay logged on their own.
UPDATE mini_sets SET nudge_id = NULL
WHERE nudge_id IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM mini_sets WHERE nudge_id IS NOT NULL GROUP BY nudge_id);
CREATE UNIQUE INDEX mini_sets_nudge ON mini_sets (nudge_id) WHERE nudge_id IS NOT NULL;

-- When the user last sent themselves a test notification, so a test cannot be sent over and over.
ALTER TABLE users ADD COLUMN push_tested_at INTEGER;

-- Goes up with every save of the mini workout settings, so a nudge planned under older settings is never sent.
ALTER TABLE users ADD COLUMN mini_revision INTEGER NOT NULL DEFAULT 0;
