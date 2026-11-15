-- Weights are stored in the user's chosen unit (users.unit). Timestamps are epoch milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb')),
  goal TEXT NOT NULL DEFAULT '',
  training_context TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE exercises (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  muscle_group TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, name)
);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai')),
  created_at INTEGER NOT NULL
);
CREATE INDEX plans_user ON plans (user_id, status);

CREATE TABLE plan_days (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL
);
CREATE INDEX plan_days_plan ON plan_days (plan_id);

CREATE TABLE plan_exercises (
  id INTEGER PRIMARY KEY,
  plan_day_id INTEGER NOT NULL REFERENCES plan_days (id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises (id),
  position INTEGER NOT NULL,
  sets INTEGER NOT NULL,
  rep_min INTEGER NOT NULL,
  rep_max INTEGER NOT NULL,
  target_weight REAL,
  increment REAL NOT NULL DEFAULT 2.5,
  rest_seconds INTEGER NOT NULL DEFAULT 120,
  notes TEXT NOT NULL DEFAULT '',
  auto_progress INTEGER NOT NULL DEFAULT 1,
  miss_streak INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX plan_exercises_day ON plan_exercises (plan_day_id);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_day_id INTEGER REFERENCES plan_days (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX workouts_user ON workouts (user_id, started_at);

CREATE TABLE workout_sets (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises (id),
  plan_exercise_id INTEGER REFERENCES plan_exercises (id) ON DELETE SET NULL,
  set_number INTEGER NOT NULL,
  weight REAL NOT NULL,
  reps INTEGER NOT NULL,
  rpe REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX workout_sets_workout ON workout_sets (workout_id);
CREATE INDEX workout_sets_exercise ON workout_sets (exercise_id);

CREATE TABLE adjustments (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises (id),
  workout_id INTEGER REFERENCES workouts (id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('rule', 'ai', 'user')),
  old_weight REAL,
  new_weight REAL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX adjustments_user ON adjustments (user_id, created_at);

CREATE TABLE coach_notes (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
