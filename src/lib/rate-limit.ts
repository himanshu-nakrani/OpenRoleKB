import { NextRequest } from "next/server";

const buckets = new Map<string, { tokens: number; lastRefill: number }>();

const MAX_REQUESTS = 10;
const WINDOW_MS = 60_000;

export function rateLimit(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anonymous";

  const now = Date.now();
  let bucket = buckets.get(ip);

  if (!bucket) {
    bucket = { tokens: MAX_REQUESTS - 1, lastRefill: now };
    buckets.set(ip, bucket);
    return true;
  }

  const elapsed = now - bucket.lastRefill;
  const windows = Math.floor(elapsed / WINDOW_MS);
  if (windows > 0) {
    bucket.tokens = Math.min(MAX_REQUESTS, bucket.tokens + windows * MAX_REQUESTS);
    bucket.lastRefill += windows * WINDOW_MS;
  }

  if (bucket.tokens <= 0) return false;

  bucket.tokens--;
  return true;
}
