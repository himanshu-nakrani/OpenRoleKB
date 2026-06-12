ALTER TABLE "SearchCache" ADD COLUMN "rawQueryHash" TEXT;
CREATE INDEX "SearchCache_rawQueryHash_idx" ON "SearchCache"("rawQueryHash");
