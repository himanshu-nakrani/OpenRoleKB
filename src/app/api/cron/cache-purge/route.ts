import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
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

  // Purge anon data older than 30 days (Q1 decision)
  // Critical: only purge rows whose ownerKey looks like an anonId (UUID — contains dashes).
  // User IDs are cuids (no dashes), so this naturally excludes them.
  // Belt-and-suspenders: also exclude any registered user IDs explicitly.
  const anonCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const userIds = await prisma.user.findMany({ select: { id: true } });
  const userIdList = userIds.map((u) => u.id);

  const { count: savedCount } = await prisma.savedSearch.deleteMany({
    where: {
      anonId: { not: null },
      createdAt: { lt: anonCutoff },
    },
  });

  // Anon ownerKeys are UUIDs (contain "-"); cuids do not. Filtering on `contains: "-"`
  // alone would safely scope to anon rows even if userIdList is empty, but we keep the
  // notIn check as a second guard. Never rely on `notIn: []` alone — Postgres treats it
  // as matching every row.
  const { count: interactionCount } = await prisma.jobInteraction.deleteMany({
    where: {
      ownerKey: { contains: "-", notIn: userIdList },
      createdAt: { lt: anonCutoff },
    },
  });

  const { count: hiddenCount } = await prisma.hiddenCompany.deleteMany({
    where: {
      ownerKey: { contains: "-", notIn: userIdList },
      createdAt: { lt: anonCutoff },
    },
  });

  return Response.json({
    purgedCaches: cacheCount,
    purgedTransferCodes: txCount,
    purgedAnonSaved: savedCount,
    purgedAnonInteractions: interactionCount,
    purgedAnonHidden: hiddenCount,
  });
}
