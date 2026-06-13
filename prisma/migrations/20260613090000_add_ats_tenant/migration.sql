CREATE TABLE "AtsTenant" (
  "id" TEXT NOT NULL,
  "ats" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "companyName" TEXT,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "lastFetchAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'candidate',
  "jobsLastSeen" INTEGER,
  "hasIndianJobs" BOOLEAN,
  "source" TEXT NOT NULL,
  "notes" TEXT,

  CONSTRAINT "AtsTenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AtsTenant_ats_slug_key" ON "AtsTenant"("ats", "slug");
CREATE INDEX "AtsTenant_status_hasIndianJobs_idx" ON "AtsTenant"("status", "hasIndianJobs");
