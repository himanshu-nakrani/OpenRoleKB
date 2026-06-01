import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateTransferCode } from "@/lib/transfer-code";
import { rateLimitTransferGen } from "@/lib/rate-limit";
import { normalizeOwnerKey } from "@/lib/owner";

const TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const rawAnonId = req.headers.get("x-anon-id");
  const anonId = rawAnonId ? normalizeOwnerKey(rawAnonId) : null;
  if (!anonId) return new Response("anon-id required", { status: 400 });

  const { ok } = await rateLimitTransferGen(anonId);
  if (!ok) return new Response("rate limited", { status: 429 });

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateTransferCode();
    try {
      const row = await prisma.transferCode.create({
        data: { code, anonId, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      return Response.json({ code: row.code, expiresAt: row.expiresAt });
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "P2002"
      )
        continue;
      throw err;
    }
  }
  return new Response("could not allocate code", { status: 500 });
}
