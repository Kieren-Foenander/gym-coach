-- The client keys of sets that were taken back. A set logged on one device and taken back on
-- another stays taken back: the first device trying it again under the same key is told so,
-- rather than logging it afresh.
CREATE TABLE mini_removed_keys (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  PRIMARY KEY (user_id, client_key)
);
