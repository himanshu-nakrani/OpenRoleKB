import { createHash } from "crypto";
import type { Filters } from "@/types/job";

export function normalizeQuery(rawQuery: string): string {
  return rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hashQuery(rawQuery: string, filters: Filters): string {
  const normalized = normalizeQuery(rawQuery);
  const payload = JSON.stringify({ q: normalized, f: filters });
  return createHash("sha256").update(payload).digest("hex");
}
