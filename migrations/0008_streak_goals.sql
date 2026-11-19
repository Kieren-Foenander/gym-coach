-- What the calendar's streaks count and how often, as JSON: [{"activity", "period", "target"}].
-- Empty means the default, a workout every week.
ALTER TABLE users ADD COLUMN streak_goals TEXT NOT NULL DEFAULT '';
