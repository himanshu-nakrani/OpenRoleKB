import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  // Fail closed if CRON_SECRET is unset OR empty. A blank env var is a common
  // misconfiguration that would otherwise let a request with an empty
  // x-cron-secret header pass `"" !== ""` → false → auth bypass.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  // Purge expired SearchCache entries (7 days)
  const cacheCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { count: cacheCount } = await prisma.searchCache.deleteMany({
    where: { createdAt: { lt: cacheCutoff } },
  });

  // Purge expired TransferCode records
  const { count: txCount } = await prisma.transferCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  // Purge anon data older than 30 days (Q1 decision).
  // Anon ownerKeys are UUIDs (contain "-"); user ids are cuids (no dashes).
  // We use raw SQL with `NOT IN (SELECT id FROM "User")` so Postgres does the
  // filter without round-tripping every user id into Node memory. The dash
  // check is the primary guard (cuids never contain "-"), and the subquery
  // is belt-and-suspenders for any future identity format change.
  const anonCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const { count: savedCount } = await prisma.savedSearch.deleteMany({
    where: {
      anonId: { not: null },
      createdAt: { lt: anonCutoff },
    },
  });

  const interactionCount = await prisma.$executeRaw`
    DELETE FROM "JobInteraction"
    WHERE "createdAt" < ${anonCutoff}
      AND "ownerKey" LIKE '%-%'
      AND "ownerKey" NOT IN (SELECT id FROM "User")
  `;

  const hiddenCount = await prisma.$executeRaw`
    DELETE FROM "HiddenCompany"
    WHERE "createdAt" < ${anonCutoff}
      AND "ownerKey" LIKE '%-%'
      AND "ownerKey" NOT IN (SELECT id FROM "User")
  `;

  return Response.json({
    purgedCaches: cacheCount,
    purgedTransferCodes: txCount,
    purgedAnonSaved: savedCount,
    purgedAnonInteractions: interactionCount,
    purgedAnonHidden: hiddenCount,
  });
}
