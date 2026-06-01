import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerKey } from "@/lib/owner";
import { rateLimit } from "@/lib/rate-limit";

const KINDS = ["saved", "hidden", "applied", "dismissed"] as const;

export async function POST(req: NextRequest) {
  const ownerKey = await getOwnerKey(req);
  const { ok } = await rateLimit(req, ownerKey ?? undefined);
  if (!ok) return new Response("rate limited", { status: 429 });

  if (!ownerKey) return new Response("x-anon-id required", { status: 401 });

  const { jobId, kind, note } = await req.json();
  if (!jobId || !KINDS.includes(kind)) {
    return new Response("invalid", { status: 400 });
  }

  const row = await prisma.jobInteraction.upsert({
    where: { ownerKey_jobId_kind: { ownerKey, jobId, kind } },
    create: { ownerKey, jobId, kind, note },
    update: { note },
  });
  return Response.json(row);
}

export async function DELETE(req: NextRequest) {
  const ownerKey = await getOwnerKey(req);
  const { ok } = await rateLimit(req, ownerKey ?? undefined);
  if (!ok) return new Response("rate limited", { status: 429 });

  if (!ownerKey) return new Response("x-anon-id required", { status: 401 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const kind = url.searchParams.get("kind");
  if (!jobId || !kind) return new Response("invalid", { status: 400 });

  await prisma.jobInteraction.deleteMany({ where: { ownerKey, jobId, kind } });
  return new Response(null, { status: 204 });
}
