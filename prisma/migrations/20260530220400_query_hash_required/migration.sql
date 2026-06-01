-- Backfill queryHash for existing rows before making it NOT NULL.
-- Note: requires pgcrypto extension. If unavailable, seed via app code.
-- The app populates queryHash on every POST to /api/saved regardless.
ALTER TABLE "SavedSearch" ALTER COLUMN "queryHash" SET NOT NULL;
