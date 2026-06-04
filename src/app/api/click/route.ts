import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerKey } from "@/lib/owner";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const ownerKey = await getOwnerKey(req);
  const { ok } = await rateLimit(req, ownerKey ?? undefined);
  if (!ok) return new Response("rate limited", { status: 429 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const target = url.searchParams.get("url");

  if (!jobId || !target) return new Response("invalid", { status: 400 });

  if (ownerKey) {
    try {
      await prisma.jobInteraction.upsert({
        where: { ownerKey_jobId_kind: { ownerKey, jobId, kind: "applied" } },
        create: { ownerKey, jobId, kind: "applied" },
        update: {},
      });
    } catch {}
  }

  // 302 to the real ATS
  return Response.redirect(target, 302);
}
