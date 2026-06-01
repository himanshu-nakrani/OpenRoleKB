import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerKey } from "@/lib/owner";
import { rateLimit } from "@/lib/rate-limit";

const KINDS = ["wrong_role", "wrong_seniority", "wrong_location", "stale", "other"] as const;

export async function POST(req: NextRequest) {
  const ownerKey = (await getOwnerKey(req)) ?? "anonymous";
  const { ok } = await rateLimit(req, ownerKey);
  if (!ok) return new Response("rate limited", { status: 429 });

  const body = await req.json();
  if (!KINDS.includes(body.kind)) return new Response("invalid kind", { status: 400 });
  if (!body.jobId || !body.rawQuery) return new Response("missing fields", { status: 400 });

  const row = await prisma.feedbackEvent.create({
    data: {
      ownerKey,
      jobId: body.jobId,
      kind: body.kind,
      rawQuery: body.rawQuery,
      filters: body.filters ?? {},
      rerankScore: body.rerankScore ?? null,
      fit: body.fit ?? null,
      comment: body.comment?.slice(0, 500) ?? null,
    },
  });
  return Response.json({ id: row.id });
}
