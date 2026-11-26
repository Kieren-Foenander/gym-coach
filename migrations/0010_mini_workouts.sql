-- Mini workouts: small sets done through the day toward daily targets, with nudges sent as push
-- notifications. Days are the calendar day in the user's time zone, as YYYY-MM-DD.

-- What the user set, as JSON (src/domain/minis.ts MiniSettings). Empty means never set up.
ALTER TABLE users ADD COLUMN mini_settings TEXT NOT NULL DEFAULT '';
-- The Monday of the last week whose targets were checked for growing, so each week is checked once.
ALTER TABLE users ADD COLUMN mini_reviewed_week TEXT NOT NULL DEFAULT '';

-- One row a day the user had targets: the targets as they were that day, whether they were all
-- met, and when the next nudge is due (null: not planned yet; 0: none left today).
CREATE TABLE mini_days (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  targets TEXT NOT NULL,
  met INTEGER NOT NULL DEFAULT 0,
  next_nudge_at INTEGER,
  PRIMARY KEY (user_id, day)
);

-- Every nudge sent, and what became of it.
CREATE TABLE mini_nudges (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  exercise TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('reps', 'seconds')),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'done', 'skipped')),
  sent_at INTEGER NOT NULL
);
CREATE INDEX mini_nudges_user_day ON mini_nudges (user_id, day);

-- What was done. client_key lets a phone resend a set whose reply was lost without logging it twice.
CREATE TABLE mini_sets (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  exercise TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('reps', 'seconds')),
  amount INTEGER NOT NULL,
  nudge_id INTEGER REFERENCES mini_nudges (id) ON DELETE SET NULL,
  client_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX mini_sets_user_day ON mini_sets (user_id, day);
CREATE UNIQUE INDEX mini_sets_client_key ON mini_sets (user_id, client_key) WHERE client_key IS NOT NULL;

-- Browsers (the installed web app) that receive nudges. The origin is the address the app was
-- opened at, which a notification opens again and the push signature names.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- The server's own key pair for signing pushes (VAPID), made on first use. One row.
CREATE TABLE push_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);
