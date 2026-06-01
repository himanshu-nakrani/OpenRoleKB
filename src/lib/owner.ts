import { auth } from "@/lib/auth";
import type { NextRequest } from "next/server";

export type OwnerIdentity = { kind: "user" | "anon"; key: string };

export function normalizeOwnerKey(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) return trimmed;
  if (/^c[a-z0-9]{24}$/.test(trimmed)) return trimmed;
  return null;
}

export async function getOwnerIdentity(req: NextRequest): Promise<OwnerIdentity | null> {
  const session = await auth();
  if (session?.user?.id) return { kind: "user", key: session.user.id };
  const anonId = req.headers.get("x-anon-id");
  if (!anonId) return null;
  const key = normalizeOwnerKey(anonId);
  if (!key) return null;
  return { kind: "anon", key };
}

export async function getOwnerKey(req: NextRequest): Promise<string | null> {
  const identity = await getOwnerIdentity(req);
  return identity?.key ?? null;
}
