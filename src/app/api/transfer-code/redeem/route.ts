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

  const row = await prisma.transferCode.findUnique({ where: { code } });
  if (!row || row.expiresAt < new Date()) {
    return new Response("not found or expired", { status: 404 });
  }

  await prisma.transferCode.delete({ where: { code } });
  return Response.json({ anonId: row.anonId });
}
