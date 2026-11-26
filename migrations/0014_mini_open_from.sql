-- The first day whose mini workout targets still follow the settings. Every day before it has ended
-- where the account was, and keeps the targets it had. It only ever moves forward, so changing time
-- zone (travelling west, say) cannot open a day that had already ended again. Empty: none has ended yet.
ALTER TABLE users ADD COLUMN mini_open_from TEXT NOT NULL DEFAULT '';
