-- The key a set's exercise is matched to a target by: trimmed, one Unicode form, lower case
-- (exerciseKey in src/domain/minis.ts). The server writes it with every set, so the database can
-- tell a day is done the way the app does, including for names SQLite's lower() cannot fold.
ALTER TABLE mini_sets ADD COLUMN exercise_key TEXT NOT NULL DEFAULT '';
-- Sets from before this: SQLite folds only ASCII here, which covers the exercise library's names.
UPDATE mini_sets SET exercise_key = lower(trim(exercise));
