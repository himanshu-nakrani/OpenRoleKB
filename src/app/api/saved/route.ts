import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const anonId = request.headers.get("x-anon-id");
  if (!anonId) {
    return NextResponse.json({ error: "x-anon-id header required" }, { status: 400 });
  }

  const saved = await prisma.savedSearch.findMany({
    where: { anonId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(saved);
}

export async function POST(request: NextRequest) {
  const anonId = request.headers.get("x-anon-id");
  if (!anonId) {
    return NextResponse.json({ error: "x-anon-id header required" }, { status: 400 });
  }

  const body = await request.json();
  const { rawQuery, filters } = body;

  if (!rawQuery) {
    return NextResponse.json({ error: "rawQuery required" }, { status: 400 });
  }

  const saved = await prisma.savedSearch.create({
    data: {
      anonId,
      rawQuery,
      filters: filters || {},
    },
  });

  return NextResponse.json(saved, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const anonId = request.headers.get("x-anon-id");
  if (!anonId) {
    return NextResponse.json({ error: "x-anon-id header required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id param required" }, { status: 400 });
  }

  const saved = await prisma.savedSearch.findUnique({ where: { id } });

  if (!saved || saved.anonId !== anonId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.savedSearch.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
