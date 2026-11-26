-- Every client key a set was logged under, its own and any that were answered with it (a nudge
-- answered from two devices, each with its own key, is one set). Taking the set back takes all of
-- them back (mini_removed_keys), so trying any of them again is told it was taken back.
CREATE TABLE mini_set_keys (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  set_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, client_key)
);
CREATE INDEX mini_set_keys_set ON mini_set_keys (set_id);
INSERT INTO mini_set_keys (user_id, client_key, set_id)
SELECT user_id, client_key, id FROM mini_sets WHERE client_key IS NOT NULL;
