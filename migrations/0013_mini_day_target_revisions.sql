-- The revision of the settings (users.mini_revision) a day's targets were taken from. Until a day
-- has ended where the account is, its targets follow the settings, and a write only replaces
-- them with targets from a later revision, so a save that finishes after a newer one never
-- undoes it. Days kept before this count as from revision 0.
ALTER TABLE mini_days ADD COLUMN targets_revision INTEGER NOT NULL DEFAULT 0;
