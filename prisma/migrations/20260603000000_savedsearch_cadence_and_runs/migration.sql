-- SavedSearch: add cadence + notification tracking columns.
-- Defaults keep existing rows behaviorally unchanged ("off" cadence = no cron pickup).
ALTER TABLE "SavedSearch"
  ADD COLUMN "cadence"         TEXT      NOT NULL DEFAULT 'off',
  ADD COLUMN "lastRunAt"       TIMESTAMP(3),
  ADD COLUMN "lastNotifiedAt"  TIMESTAMP(3),
  ADD COLUMN "notifyEmail"     TEXT;

-- Index that the cron query depends on: WHERE cadence != 'off' AND lastRunAt < cutoff.
CREATE INDEX "SavedSearch_cadence_lastRunAt_idx"
  ON "SavedSearch"("cadence", "lastRunAt");

-- SavedSearchRun: history of cron-driven re-runs. Each row records the
-- delta vs the previous run for the same saved search.
CREATE TABLE "SavedSearchRun" (
  "id"            TEXT     NOT NULL,
  "savedSearchId" TEXT     NOT NULL,
  "newJobIds"     TEXT[]   NOT NULL,
  "deltaCount"    INTEGER  NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedSearchRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedSearchRun_savedSearchId_createdAt_idx"
  ON "SavedSearchRun"("savedSearchId", "createdAt");

ALTER TABLE "SavedSearchRun"
  ADD CONSTRAINT "SavedSearchRun_savedSearchId_fkey"
  FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
