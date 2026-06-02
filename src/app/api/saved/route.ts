import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOwnerIdentity, type OwnerIdentity } from "@/lib/owner";
import { hashQuery } from "@/lib/hash";
import { sanitizeFilters } from "@/lib/parse-query";
import type { Prisma } from "../../../../generated/prisma/client";

function identityFilter(identity: OwnerIdentity) {
  return identity.kind === "user"
    ? { userId: identity.key }
    : { anonId: identity.key };
}

export async function GET(request: NextRequest) {
  const identity = await getOwnerIdentity(request);
  const { ok } = await rateLimit(request, identity?.key);
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!identity) {
    return NextResponse.json({ error: "x-anon-id header required" }, { status: 400 });
  }

  const saved = await prisma.savedSearch.findMany({
    where: identityFilter(identity),
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(saved);
}

export async function POST(request: NextRequest) {
  const identity = await getOwnerIdentity(request);
  const { ok } = await rateLimit(request, identity?.key);
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!identity) {
    return NextResponse.json({ error: "x-anon-id header required" }, { status: 400 });
  }

  const body = await request.json();
  const { rawQuery, filters: rawFilters } = body;

  if (!rawQuery || typeof rawQuery !== "string") {
    return NextResponse.json({ error: "rawQuery required" }, { status: 400 });
  }

  if (rawQuery.length > 1000) {
    return NextResponse.json({ error: "query too long" }, { status: 400 });
  }

  const filters = rawFilters ? sanitizeFilters(rawFilters) : {};
  const queryHash = hashQuery(rawQuery, filters);
  const filtersJson = filters as Prisma.InputJsonValue;

  const where = identity.kind === "user"
    ? { userId_queryHash: { userId: identity.key, queryHash } }
    : { anonId_queryHash: { anonId: identity.key, queryHash } };

  const data = identity.kind === "user"
    ? { userId: identity.key, rawQuery, filters: filtersJson, queryHash }
    : { anonId: identity.key, rawQuery, filters: filtersJson, queryHash };

  const saved = await prisma.savedSearch.upsert({
    where,
    create: data,
    update: { rawQuery, filters: filtersJson },
  });

  return NextResponse.json(saved);
}

export async function DELETE(request: NextRequest) {
  const identity = await getOwnerIdentity(request);
  const { ok } = await rateLimit(request, identity?.key);
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!identity) {
    return NextResponse.json({ error: "x-anon-id header required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id param required" }, { status: 400 });
  }

  const { count } = await prisma.savedSearch.deleteMany({
    where: { id, ...identityFilter(identity) },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}

export async function PATCH(request: NextRequest) {
  const identity = await getOwnerIdentity(request);
  const { ok } = await rateLimit(request, identity?.key);
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!identity) {
    return NextResponse.json({ error: "x-anon-id header required" }, { status: 400 });
  }

  const body = await request.json();
  const { id, cadence, notifyEmail } = body;

  if (!id) {
    return NextResponse.json({ error: "id param required" }, { status: 400 });
  }

  if (cadence && !["off", "daily", "weekly"].includes(cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
  }

  if (cadence !== "off" && identity.kind !== "user" && !notifyEmail) {
    return NextResponse.json({ error: "Email required for anonymous saved searches with cadence" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (cadence !== undefined) updateData.cadence = cadence;
  if (notifyEmail !== undefined) updateData.notifyEmail = notifyEmail;

  const updated = await prisma.savedSearch.update({
    where: { id, ...identityFilter(identity) },
    data: updateData,
  });

  return NextResponse.json(updated);
}
