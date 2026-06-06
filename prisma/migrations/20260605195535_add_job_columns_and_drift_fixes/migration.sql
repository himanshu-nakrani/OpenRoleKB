-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "dedupKey" TEXT,
ADD COLUMN     "locationRaw" TEXT,
ADD COLUMN     "salaryMaxUsd" INTEGER,
ADD COLUMN     "salaryMinUsd" INTEGER,
ADD COLUMN     "salaryRaw" TEXT;

-- AlterTable
ALTER TABLE "SavedSearch" ALTER COLUMN "anonId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
