-- Cardio is logged by time and distance. A cardio set has weight 0 and reps 0.
-- Distance is in km for kg users and miles for lb users.
ALTER TABLE workout_sets ADD COLUMN duration_seconds INTEGER;
ALTER TABLE workout_sets ADD COLUMN distance REAL;
