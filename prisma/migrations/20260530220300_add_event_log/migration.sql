-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "evt" TEXT NOT NULL,
    "ownerKey" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "resultCount" INTEGER NOT NULL,
    "parseMs" INTEGER NOT NULL,
    "exaMs" INTEGER NOT NULL,
    "rerankMs" INTEGER NOT NULL,
    "totalMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLog_evt_createdAt_idx" ON "EventLog"("evt", "createdAt");
