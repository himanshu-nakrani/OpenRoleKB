import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerKey } from "@/lib/owner";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ownerKey = await getOwnerKey(req);
  const { ok } = await rateLimit(req, ownerKey ?? undefined);
  if (!ok) return new Response("rate limited", { status: 429 });

  if (!ownerKey) return new Response("x-anon-id required", { status: 401 });

  const { company } = await req.json();
  if (!company || typeof company !== "string") {
    return new Response("company required", { status: 400 });
  }

  const row = await prisma.hiddenCompany.upsert({
    where: { ownerKey_company: { ownerKey, company: company.trim().toLowerCase() } },
    create: { ownerKey, company: company.trim().toLowerCase() },
    update: {},
  });
  return Response.json(row);
}

export async function DELETE(req: NextRequest) {
  const ownerKey = await getOwnerKey(req);
  const { ok } = await rateLimit(req, ownerKey ?? undefined);
  if (!ok) return new Response("rate limited", { status: 429 });

  if (!ownerKey) return new Response("x-anon-id required", { status: 401 });

  const url = new URL(req.url);
  const company = url.searchParams.get("company");
  if (!company) return new Response("company required", { status: 400 });

  await prisma.hiddenCompany.deleteMany({ where: { ownerKey, company: company.trim().toLowerCase() } });
  return new Response(null, { status: 204 });
}
