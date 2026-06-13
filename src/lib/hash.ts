import { createHash } from "crypto";
import type { Filters } from "@/types/job";

export function normalizeQuery(rawQuery: string): string {
  return rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

export function hashQuery(rawQuery: string, filters: Filters): string {
  const normalized = normalizeQuery(rawQuery);
  const payload = JSON.stringify({ q: normalized, f: canonicalize(filters) });
  return createHash("sha256").update(payload).digest("hex");
}

export function hashRawQuery(rawQuery: string): string {
  return createHash("sha256").update(normalizeQuery(rawQuery)).digest("hex");
}
