-- An exercise substituted for a planned one, for a single workout.
CREATE TABLE workout_swaps (
  workout_id INTEGER NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
  plan_exercise_id INTEGER NOT NULL REFERENCES plan_exercises (id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises (id),
  PRIMARY KEY (workout_id, plan_exercise_id)
);
