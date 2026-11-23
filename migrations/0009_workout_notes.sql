-- A note written on a set while doing it, such as "left knee twinged". Empty means none.
ALTER TABLE workout_sets ADD COLUMN note TEXT NOT NULL DEFAULT '';

-- A note on one exercise in one workout, such as "seat on 4" or "bench was taken, used the far one".
CREATE TABLE workout_exercise_notes (
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  PRIMARY KEY (workout_id, exercise_id)
);
