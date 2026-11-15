-- Exercises added to a workout on the day, beyond what the plan prescribes.
CREATE TABLE workout_extras (
  workout_id INTEGER NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises (id),
  position INTEGER NOT NULL,
  PRIMARY KEY (workout_id, exercise_id)
);

-- Bodyweight and tape measurements. Weight is in the user's weight unit; lengths are cm for kg users and inches for lb users.
CREATE TABLE body_measurements (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value REAL NOT NULL,
  measured_at INTEGER NOT NULL
);
CREATE INDEX body_measurements_user ON body_measurements (user_id, kind, measured_at);
