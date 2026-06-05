import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../test/fixtures/exa-results.json"), "utf-8"),
);
const rerankFixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../test/fixtures/rerank-response.json"), "utf-8"),
);

let container: StartedPostgreSqlContainer;
let originalDbUrl: string | undefined;

beforeAll(async () => {
  originalDbUrl = process.env.DATABASE_URL;
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  
  // Run Prisma migrations
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  await execAsync(`npx prisma db push --schema=prisma/schema.prisma`, {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}, 120000);

afterAll(async () => {
  if (container) {
    await container.stop();
  }
  if (originalDbUrl) {
    process.env.DATABASE_URL = originalDbUrl;
  }
});

beforeEach(async () => {
  // Clear database before each test using Prisma directly
  const { prisma } = await import("@/lib/prisma");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EventLog" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "SearchCache" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Job" CASCADE`);
});

describe("POST /api/search Contract Test", () => {
  it("performs cache miss on first request and cache hit on second, logging EventLog correctly", async () => {
    // Mock dependencies
    vi.resetModules();
    const mockParseQuery = vi.fn().mockResolvedValue({ filters: { role: "react" }, rawQuery: "react developer" });
    const mockSearchJobs = vi.fn().mockResolvedValue(fixtures);
    const mockRerankWithMetrics = vi.fn().mockResolvedValue({ items: rerankFixture, tokens: 100 });
    const mockRateLimit = vi.fn().mockResolvedValue({ ok: true });
    const mockGetOwnerKey = vi.fn().mockResolvedValue("test-owner-key");

    vi.doMock("@/lib/parse-query", () => ({ parseQuery: mockParseQuery, sanitizeFilters: (f: unknown) => f }));
    vi.doMock("@/lib/exa", () => ({ searchJobs: mockSearchJobs }));
    vi.doMock("@/lib/rerank", () => ({ rerankWithMetrics: mockRerankWithMetrics }));
    vi.doMock("@/lib/rate-limit", () => ({ rateLimit: mockRateLimit }));
    vi.doMock("@/lib/owner", () => ({ getOwnerKey: mockGetOwnerKey, normalizeOwnerKey: vi.fn().mockReturnValue("test-owner-key") }));

    // Import after mocking
    const { POST } = await import("@/app/api/search/route");
    const { prisma } = await import("@/lib/prisma");

    const req1 = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "react developer" }),
    });

    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    
    // Read stream to completion
    const reader1 = res1.body!.getReader();
    const decoder = new TextDecoder();
    let buffer1 = "";
    while (true) {
      const { done, value } = await reader1.read();
      if (done) break;
      buffer1 += decoder.decode(value, { stream: true });
    }
    expect(buffer1).toContain("event: done");

    // Assert cache miss and EventLog write
    const eventLogs1 = await prisma.eventLog.findMany({
      where: { ownerKey: "test-owner-key", evt: "search" },
      orderBy: { createdAt: "desc" },
    });
    expect(eventLogs1.length).toBe(1);
    expect(eventLogs1[0].cacheHit).toBe(false);
    expect(eventLogs1[0].resultCount).toBeGreaterThan(0);
    expect(eventLogs1[0].exaCostUsd).toBeDefined();
    expect(eventLogs1[0].llmCostUsd).toBeDefined();

    // Second request (should be cache hit)
    const req2 = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "react developer" }),
    });

    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    const reader2 = res2.body!.getReader();
    let buffer2 = "";
    while (true) {
      const { done, value } = await reader2.read();
      if (done) break;
      buffer2 += decoder.decode(value, { stream: true });
    }
    expect(buffer2).toContain("event: done");

    // Assert cache hit and second EventLog write
    const eventLogs2 = await prisma.eventLog.findMany({
      where: { ownerKey: "test-owner-key", evt: "search" },
      orderBy: { createdAt: "desc" },
    });
    expect(eventLogs2.length).toBe(2);
    expect(eventLogs2[0].cacheHit).toBe(true);
    expect(eventLogs2[0].resultCount).toBe(eventLogs1[0].resultCount);
    expect(eventLogs2[0].exaMs).toBe(0);
    expect(eventLogs2[0].rerankMs).toBe(0);
  });
});
