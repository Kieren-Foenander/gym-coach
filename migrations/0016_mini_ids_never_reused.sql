-- Sets and nudges get ids that are never given out again. Without AUTOINCREMENT, SQLite hands the
-- newest row's id to the next one once that row is deleted, so a screen still showing a deleted set
-- (or a notification for a nudge that was never delivered) would name a different one.
--
-- SQLite cannot change a primary key in place, so both tables are made again and their rows copied.
-- The new sets table points at the new nudges table, and the old tables go child first, so no
-- foreign key action touches the copied rows.

CREATE TABLE mini_nudges_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  exercise TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('reps', 'seconds')),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'done', 'skipped')),
  sent_at INTEGER NOT NULL
);
INSERT INTO mini_nudges_new (id, user_id, day, exercise, unit, amount, status, sent_at)
SELECT id, user_id, day, exercise, unit, amount, status, sent_at FROM mini_nudges;

CREATE TABLE mini_sets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  exercise TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('reps', 'seconds')),
  amount INTEGER NOT NULL,
  nudge_id INTEGER REFERENCES mini_nudges_new (id) ON DELETE SET NULL,
  client_key TEXT,
  created_at INTEGER NOT NULL,
  exercise_key TEXT NOT NULL DEFAULT ''
);
INSERT INTO mini_sets_new (id, user_id, day, exercise, unit, amount, nudge_id, client_key, created_at, exercise_key)
SELECT id, user_id, day, exercise, unit, amount, nudge_id, client_key, created_at, exercise_key FROM mini_sets;

DROP TABLE mini_sets;
DROP TABLE mini_nudges;
ALTER TABLE mini_nudges_new RENAME TO mini_nudges;
ALTER TABLE mini_sets_new RENAME TO mini_sets;

CREATE INDEX mini_nudges_user_day ON mini_nudges (user_id, day);
CREATE INDEX mini_sets_user_day ON mini_sets (user_id, day);
CREATE UNIQUE INDEX mini_sets_client_key ON mini_sets (user_id, client_key) WHERE client_key IS NOT NULL;
CREATE UNIQUE INDEX mini_sets_nudge ON mini_sets (nudge_id) WHERE nudge_id IS NOT NULL;
