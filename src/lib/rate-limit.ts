import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";

// ── Upstash (production) ──────────────────────────────────────────────
let redis: Redis | null = null;
let ipLimiter: Ratelimit | null = null;
let ownerLimiter: Ratelimit | null = null;

function initUpstash() {
  if (redis) return true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  redis = new Redis({ url, token });
  ipLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "rl:ip",
  });
  ownerLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(100, "24 h"),
    prefix: "rl:owner",
  });
  return true;
}

// ── In-memory fallback (local dev without Redis) ──────────────────────
const buckets = new Map<string, { tokens: number; lastRefill: number }>();
const MAX_REQUESTS = 10;
const WINDOW_MS = 60_000;

function inMemoryLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket) {
    if (buckets.size > 10_000) buckets.clear();
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

// ── Public API ────────────────────────────────────────────────────────

export async function rateLimit(
  req: NextRequest,
  ownerKey?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anonymous";

  if (initUpstash() && ipLimiter) {
    const ipResult = await ipLimiter.limit(ip);
    if (!ipResult.success) return { ok: false, reason: "ip" };

    if (ownerKey && ownerLimiter) {
      const ownerResult = await ownerLimiter.limit(ownerKey);
      if (!ownerResult.success) return { ok: false, reason: "owner" };
    }
    return { ok: true };
  }

  // In-memory fallback
  const allowed = inMemoryLimit(ip);
  return { ok: allowed, reason: allowed ? undefined : "ip" };
}

// ── Named limiters for transfer codes (Phase 6) ───────────────────────
let transferGenLimiter: Ratelimit | null = null;
let transferRedeemLimiter: Ratelimit | null = null;

export async function rateLimitTransferGen(anonId: string): Promise<{ ok: boolean }> {
  if (initUpstash()) {
    if (!transferGenLimiter) {
      transferGenLimiter = new Ratelimit({
        redis: redis!,
        limiter: Ratelimit.fixedWindow(3, "1 h"),
        prefix: "rl:xfer-gen",
      });
    }
    const r = await transferGenLimiter.limit(anonId);
    return { ok: r.success };
  }
  return { ok: true }; // no limit in local dev
}

export async function rateLimitTransferRedeem(ip: string): Promise<{ ok: boolean }> {
  if (initUpstash()) {
    if (!transferRedeemLimiter) {
      transferRedeemLimiter = new Ratelimit({
        redis: redis!,
        limiter: Ratelimit.fixedWindow(5, "60 s"),
        prefix: "rl:xfer-redeem",
      });
    }
    const r = await transferRedeemLimiter.limit(ip);
    return { ok: r.success };
  }
  return { ok: true }; // no limit in local dev
}
