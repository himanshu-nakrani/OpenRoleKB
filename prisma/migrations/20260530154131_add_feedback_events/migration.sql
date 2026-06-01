-- CreateTable
CREATE TABLE "FeedbackEvent" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rawQuery" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "rerankScore" DOUBLE PRECISION,
    "fit" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackEvent_kind_createdAt_idx" ON "FeedbackEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEvent_ownerKey_createdAt_idx" ON "FeedbackEvent"("ownerKey", "createdAt");
