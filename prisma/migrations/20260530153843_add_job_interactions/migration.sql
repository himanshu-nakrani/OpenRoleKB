-- AlterTable
ALTER TABLE "SavedSearch" ADD COLUMN     "queryHash" TEXT;

-- CreateTable
CREATE TABLE "JobInteraction" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiddenCompany" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobInteraction_ownerKey_kind_idx" ON "JobInteraction"("ownerKey", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "JobInteraction_ownerKey_jobId_kind_key" ON "JobInteraction"("ownerKey", "jobId", "kind");

-- CreateIndex
CREATE INDEX "HiddenCompany_ownerKey_idx" ON "HiddenCompany"("ownerKey");

-- CreateIndex
CREATE UNIQUE INDEX "HiddenCompany_ownerKey_company_key" ON "HiddenCompany"("ownerKey", "company");

-- AddForeignKey
ALTER TABLE "JobInteraction" ADD CONSTRAINT "JobInteraction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
