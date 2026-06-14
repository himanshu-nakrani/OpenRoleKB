-- Add per-dimension breakdown column so eval trends can be sliced by check,
-- not just by overall pass/fail.
ALTER TABLE "EvalRun" ADD COLUMN "dimensions" JSONB NOT NULL DEFAULT '[]';
