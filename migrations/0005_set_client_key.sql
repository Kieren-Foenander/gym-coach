-- A key the native app makes up for each set it logs. A set sent twice with the same key is
-- logged once, so the app can resend sets it logged with no signal without doubling them.
ALTER TABLE workout_sets ADD COLUMN client_key TEXT;
CREATE UNIQUE INDEX workout_sets_client_key ON workout_sets (workout_id, client_key) WHERE client_key IS NOT NULL;
