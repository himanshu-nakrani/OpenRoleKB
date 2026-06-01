-- CreateTable
CREATE TABLE "TransferCode" (
    "code" TEXT NOT NULL,
    "anonId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "TransferCode_expiresAt_idx" ON "TransferCode"("expiresAt");
