-- SavedSearch: prevent duplicate saves for the same anon identity.
-- Existing duplicates (if any) would block the constraint; dedupe first.
-- Tiebreaker on id handles the rare case where two duplicates share the exact
-- same createdAt (cuid lexicographic order is monotonic-enough for "keep one").
DELETE FROM "SavedSearch" a
USING "SavedSearch" b
WHERE a."anonId" IS NOT NULL
  AND a."anonId" = b."anonId"
  AND a."queryHash" = b."queryHash"
  AND (
    a."createdAt" < b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" < b."id")
  );

CREATE UNIQUE INDEX "SavedSearch_anonId_queryHash_key"
  ON "SavedSearch"("anonId", "queryHash");

-- EventLog: new metrics columns. Defaults make the change backwards-compatible
-- with rows written by older app instances during a rolling deploy.
ALTER TABLE "EventLog"
  ADD COLUMN "rerankFailed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cacheMs" INTEGER DEFAULT 0;
