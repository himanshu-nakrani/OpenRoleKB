-- EvalRun: rows from the nightly search-quality eval. One row per golden case per run.
CREATE TABLE "EvalRun" (
  "id"         TEXT NOT NULL,
  "runId"      TEXT NOT NULL,
  "caseName"   TEXT NOT NULL,
  "query"      TEXT NOT NULL,
  "score"      DOUBLE PRECISION NOT NULL,
  "passed"     BOOLEAN NOT NULL,
  "failures"   JSONB NOT NULL DEFAULT '[]',
  "durationMs" INTEGER NOT NULL,
  "tokens"     INTEGER,
  "costUsd"    DOUBLE PRECISION,
  "rubric"     TEXT NOT NULL,
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvalRun_runId_idx"            ON "EvalRun"("runId");
CREATE INDEX "EvalRun_createdAt_idx"        ON "EvalRun"("createdAt");
CREATE INDEX "EvalRun_passed_createdAt_idx" ON "EvalRun"("passed", "createdAt");
