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
  if (!jobId) return new Response("invalid", { status: 400 });

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { url: true },
  });
  if (!job) return new Response("job not found", { status: 404 });

  if (ownerKey) {
    try {
      await prisma.jobInteraction.upsert({
        where: { ownerKey_jobId_kind: { ownerKey, jobId, kind: "applied" } },
        create: { ownerKey, jobId, kind: "applied" },
        update: {},
      });
    } catch {}
  }

  // 302 to the trusted ATS URL from DB (prevents open redirect)
  return Response.redirect(job.url, 302);
}
