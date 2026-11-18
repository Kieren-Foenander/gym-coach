-- The food log. An entry is a meal, a snack or a day's total, logged in the app or by the coach.
-- The day is the calendar day on the user's device, as YYYY-MM-DD. Macros are grams and may be unknown.
CREATE TABLE food_entries (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  description TEXT NOT NULL,
  calories REAL NOT NULL,
  protein REAL,
  carbs REAL,
  fat REAL,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai')),
  created_at INTEGER NOT NULL
);
CREATE INDEX food_entries_user_day ON food_entries (user_id, day);

-- Daily targets for the food log, set by the user or the coach. Null means none.
ALTER TABLE users ADD COLUMN calorie_target INTEGER;
ALTER TABLE users ADD COLUMN protein_target INTEGER;
