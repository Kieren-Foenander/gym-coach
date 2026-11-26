-- A token new with every write of the mini workout settings. The rest of a settings write goes in
-- only if the token is its own, so a write that lost to another writing the very same settings
-- cannot act as though it had won.
ALTER TABLE users ADD COLUMN mini_write_token TEXT NOT NULL DEFAULT '';
