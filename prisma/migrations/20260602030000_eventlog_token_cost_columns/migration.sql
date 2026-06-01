-- EventLog: token + cost capture for nightly eval and cost dashboards.
ALTER TABLE "EventLog"
  ADD COLUMN "parseTokens"  INTEGER,
  ADD COLUMN "rerankTokens" INTEGER,
  ADD COLUMN "exaCostUsd"   DOUBLE PRECISION,
  ADD COLUMN "llmCostUsd"   DOUBLE PRECISION;
