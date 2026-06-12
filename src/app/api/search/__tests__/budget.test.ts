import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../test/fixtures/exa-results.json"), "utf-8"),
);
const rerankFixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../test/fixtures/rerank-response.json"), "utf-8"),
);

const mockParseQuery = vi.fn();
const mockSearchJobs = vi.fn();
const mockSearchJobsWithReport = vi.fn();
const mockSearchLocalJobs = vi.fn();
const EMPTY_QUALITY = { kept: 0, denylist_path: 0, ats_url_not_individual_job: 0, no_signals: 0 };
const EMPTY_LOCAL = { results: [], rawHits: 0, tsquery: null };
const mockRerankWithMetrics = vi.fn();
const mockCacheSearch = vi.fn();
const mockGetCachedSearch = vi.fn();
const mockRateLimit = vi.fn();
const mockEventLogCreate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/parse-query", () => ({ parseQuery: mockParseQuery, sanitizeFilters: (f: unknown) => f }));
vi.mock("@/lib/exa", () => ({
  searchJobs: mockSearchJobs,
  searchJobsWithReport: mockSearchJobsWithReport,
}));
vi.mock("@/lib/local-search", () => ({ searchLocalJobs: mockSearchLocalJobs }));
vi.mock("@/lib/rerank", () => ({ rerankWithMetrics: mockRerankWithMetrics }));
vi.mock("@/lib/cache", () => ({ cacheSearch: mockCacheSearch, getCachedSearch: mockGetCachedSearch, getCachedSearchByRawQuery: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mockRateLimit }));
vi.mock("@/lib/owner", () => ({
  getOwnerKey: vi.fn().mockResolvedValue(null),
  normalizeOwnerKey: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { eventLog: { create: mockEventLogCreate }, hiddenCompany: { findMany: vi.fn().mockResolvedValue([]) } },
}));

const { POST } = await import("@/app/api/search/route");

interface SSEEvent { event: string; data: unknown }

async function readSSE(res: Response): Promise<SSEEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SSEEvent[] = [];
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    let ev = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) ev = line.slice(7);
      else if (line.startsWith("data: ") && ev) {
        events.push({ event: ev, data: JSON.parse(line.slice(6)) });
        ev = "";
      }
    }
  }
  return events;
}

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("budget — cost + token tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ ok: true });
    mockGetCachedSearch.mockResolvedValue(null);
    mockParseQuery.mockResolvedValue({ filters: { role: "x" }, rawQuery: "x", tokens: 180 });
    mockSearchJobs.mockResolvedValue(fixtures);
    mockSearchJobsWithReport.mockResolvedValue({ results: fixtures, quality: EMPTY_QUALITY });
    mockSearchLocalJobs.mockResolvedValue(EMPTY_LOCAL);
    mockRerankWithMetrics.mockResolvedValue({ items: rerankFixture, tokens: 3200 });
    mockCacheSearch.mockResolvedValue("c-1");
  });

  it("records parseTokens, rerankTokens, exaCostUsd, llmCostUsd in EventLog (cache miss)", async () => {
    const res = await POST(makeReq({ query: "x" }));
    await readSSE(res);

    expect(mockEventLogCreate).toHaveBeenCalledTimes(1);
    const data = mockEventLogCreate.mock.calls[0][0].data;
    expect(data.parseTokens).toBe(180);
    expect(data.rerankTokens).toBe(3200);
    expect(data.exaCostUsd).toBeCloseTo(0.005);
    // (180 + 3200) tokens × $0.00027/1000 ≈ $0.000913
    expect(data.llmCostUsd).toBeGreaterThan(0);
    expect(data.llmCostUsd).toBeLessThan(0.01);
  });

  it("records ZERO Exa cost + zero token cost on cache hit", async () => {
    mockGetCachedSearch.mockResolvedValue({
      cache: { id: "c-cached", rerankScores: {} },
      jobs: fixtures.slice(0, 3),
      resultJobIds: fixtures.slice(0, 3).map((j: { id: string }) => j.id),
    });

    const res = await POST(makeReq({ query: "x" }));
    await readSSE(res);

    expect(mockSearchJobsWithReport).not.toHaveBeenCalled();
    expect(mockRerankWithMetrics).not.toHaveBeenCalled();
    const data = mockEventLogCreate.mock.calls[0][0].data;
    expect(data.exaMs).toBe(0);
    expect(data.exaCostUsd).toBeUndefined();
    expect(data.llmCostUsd).toBeUndefined();
    expect(data.cacheHit).toBe(true);
  });

  it("does NOT write llmCostUsd when rerank fails (uses fallback scores)", async () => {
    mockRerankWithMetrics.mockRejectedValue(new Error("boom"));

    const res = await POST(makeReq({ query: "x" }));
    await readSSE(res);

    const data = mockEventLogCreate.mock.calls[0][0].data;
    expect(data.rerankFailed).toBe(true);
    expect(data.rerankTokens).toBeUndefined();
    // parse still ran, so its cost is recorded
    expect(data.parseTokens).toBe(180);
    expect(data.llmCostUsd).toBeGreaterThan(0);
  });
});

describe("budget — latency budgets (synthetic timing)", () => {
  // These don't measure wall time (flaky in CI). They assert the route
  // captures parseMs/exaMs/rerankMs/totalMs in the right ranges.
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ ok: true });
    mockGetCachedSearch.mockResolvedValue(null);
    mockParseQuery.mockResolvedValue({ filters: { role: "x" }, rawQuery: "x" });
    mockSearchJobs.mockResolvedValue(fixtures);
    mockSearchJobsWithReport.mockResolvedValue({ results: fixtures, quality: EMPTY_QUALITY });
    mockSearchLocalJobs.mockResolvedValue(EMPTY_LOCAL);
    mockRerankWithMetrics.mockResolvedValue({ items: rerankFixture, tokens: 0 });
    mockCacheSearch.mockResolvedValue("c-1");
  });

  it("cache miss: records parseMs, exaMs, rerankMs, totalMs all ≥ 0", async () => {
    const res = await POST(makeReq({ query: "x" }));
    await readSSE(res);
    const data = mockEventLogCreate.mock.calls[0][0].data;
    expect(data.parseMs).toBeGreaterThanOrEqual(0);
    expect(data.exaMs).toBeGreaterThanOrEqual(0);
    expect(data.rerankMs).toBeGreaterThanOrEqual(0);
    expect(data.totalMs).toBeGreaterThanOrEqual(data.parseMs);
  });

  it("cache hit: exaMs is exactly 0 and cacheMs is > 0 OR 0 (never negative)", async () => {
    mockGetCachedSearch.mockResolvedValue({
      cache: { id: "c-cached", rerankScores: {} },
      jobs: fixtures.slice(0, 3),
      resultJobIds: fixtures.slice(0, 3).map((j: { id: string }) => j.id),
    });

    const res = await POST(makeReq({ query: "x" }));
    await readSSE(res);

    const data = mockEventLogCreate.mock.calls[0][0].data;
    expect(data.exaMs).toBe(0);
    expect(data.rerankMs).toBe(0);
    expect(data.cacheMs).toBeGreaterThanOrEqual(0);
  });
});
