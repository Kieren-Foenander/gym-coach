-- Data the iPhone app brings in from Apple Health. Every record keeps the id Health gave it,
-- so sending it twice adds it once and deleting it in Health removes it here.

-- A measurement from Health (bodyweight, body fat, waist). Logged by hand when health_id is null.
ALTER TABLE body_measurements ADD COLUMN health_id TEXT;
CREATE UNIQUE INDEX body_measurements_health ON body_measurements (user_id, health_id) WHERE health_id IS NOT NULL;

-- 'health' for a cardio workout that was made from a Health workout, 'app' for everything else.
ALTER TABLE workouts ADD COLUMN source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'health'));

-- Every workout Health recorded, such as one tracked on an Apple Watch. It joins the workout in the
-- app it happened during, or becomes a workout of its own when it is cardio. Anything else stays
-- here unjoined (workout_id null) for the coach to read.
CREATE TABLE health_workouts (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  health_id TEXT NOT NULL,
  workout_id INTEGER REFERENCES workouts (id) ON DELETE SET NULL,
  activity INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  energy_kcal REAL,
  avg_heart_rate REAL,
  PRIMARY KEY (user_id, health_id)
);
CREATE INDEX health_workouts_workout ON health_workouts (workout_id);
CREATE INDEX health_workouts_time ON health_workouts (user_id, started_at);

-- One number per day per metric: sleep, resting heart rate, HRV, steps, active energy, VO2 max.
-- The day is the calendar day on the phone, as YYYY-MM-DD.
CREATE TABLE health_daily (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (user_id, day, metric)
);
