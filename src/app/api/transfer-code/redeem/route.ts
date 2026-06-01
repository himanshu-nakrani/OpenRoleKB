import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitTransferRedeem } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anonymous";

  const { ok } = await rateLimitTransferRedeem(ip);
  if (!ok) return new Response("rate limited", { status: 429 });

  const { code } = await req.json();
  if (typeof code !== "string" || !/^[A-Z0-9]{6}$/.test(code)) {
    return new Response("invalid code", { status: 400 });
  }

  // Atomic redeem: delete returns the row that was deleted. If two redeemers
  // race, exactly one DELETE succeeds; the other gets P2025 (record not found)
  // which we surface as 404 instead of an unhandled 500.
  try {
    const deleted = await prisma.transferCode.delete({ where: { code } });
    if (deleted.expiresAt < new Date()) {
      return new Response("not found or expired", { status: 404 });
    }
    return Response.json({ anonId: deleted.anonId });
  } catch {
    return new Response("not found or expired", { status: 404 });
  }
}
