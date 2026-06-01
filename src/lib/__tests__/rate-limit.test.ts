import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// We need to test the in-memory fallback path since we don't have Upstash in CI.
// The rateLimit function falls back to in-memory when UPSTASH_REDIS_REST_URL is not set.

// Clear any Upstash env vars before import
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const { rateLimit } = await import("@/lib/rate-limit");

function makeReq(ip: string): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimit (in-memory fallback)", () => {
  let now: number;

  beforeEach(() => {
    now = 1000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  it("allows exactly 10 requests and then denies", async () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 10; i++) {
      const r = await rateLimit(makeReq(ip));
      expect(r.ok).toBe(true);
    }
    const r = await rateLimit(makeReq(ip));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ip");
  });

  it("does not refill within one window (30s advance)", async () => {
    const ip = "192.168.1.2";
    for (let i = 0; i < 10; i++) await rateLimit(makeReq(ip));

    now += 30_000;
    const r = await rateLimit(makeReq(ip));
    expect(r.ok).toBe(false);
  });

  it("refills exactly 10 after one full window", async () => {
    const ip = "192.168.1.3";
    for (let i = 0; i < 10; i++) await rateLimit(makeReq(ip));

    now += 60_000;
    for (let i = 0; i < 10; i++) {
      const r = await rateLimit(makeReq(ip));
      expect(r.ok).toBe(true);
    }
    const r = await rateLimit(makeReq(ip));
    expect(r.ok).toBe(false);
  });

  it("caps refill at 10, no overflow", async () => {
    const ip = "192.168.1.4";
    for (let i = 0; i < 5; i++) await rateLimit(makeReq(ip));

    now += 150_000; // 2.5 windows
    for (let i = 0; i < 10; i++) {
      const r = await rateLimit(makeReq(ip));
      expect(r.ok).toBe(true);
    }
    const r = await rateLimit(makeReq(ip));
    expect(r.ok).toBe(false);
  });

  it("different IPs have independent buckets", async () => {
    const ip1 = "192.168.1.5";
    const ip2 = "10.0.0.1";

    for (let i = 0; i < 10; i++) await rateLimit(makeReq(ip1));
    expect((await rateLimit(makeReq(ip1))).ok).toBe(false);
    expect((await rateLimit(makeReq(ip2))).ok).toBe(true);
  });
});
