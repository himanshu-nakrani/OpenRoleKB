-- Full-text search column for Layer A local-corpus retrieval.
-- Generated column stays in sync automatically; GIN index makes
-- ts_rank queries against a multi-thousand-row Job table sub-50ms.
ALTER TABLE "Job" ADD COLUMN "search_doc" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("company", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX "Job_search_doc_idx" ON "Job" USING GIN ("search_doc");
