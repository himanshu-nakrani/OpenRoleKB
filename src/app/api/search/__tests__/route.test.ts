import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../test/fixtures/exa-results.json"), "utf-8"),
);
const rerankFixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../test/fixtures/rerank-response.json"), "utf-8"),
);

const mockParseQuery = vi.fn();
const mockSearchJobs = vi.fn();
const mockRerank = vi.fn();
const mockRerankWithMetrics = vi.fn();
const mockCacheSearch = vi.fn();
const mockGetCachedSearch = vi.fn();
const mockRateLimit = vi.fn();

vi.mock("@/lib/parse-query", () => ({ parseQuery: mockParseQuery, sanitizeFilters: (f: unknown) => f }));
vi.mock("@/lib/exa", () => ({ searchJobs: mockSearchJobs }));
vi.mock("@/lib/rerank", () => ({ rerank: mockRerank, rerankWithMetrics: mockRerankWithMetrics }));
vi.mock("@/lib/cache", () => ({ cacheSearch: mockCacheSearch, getCachedSearch: mockGetCachedSearch }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mockRateLimit }));
vi.mock("@/lib/owner", () => ({ getOwnerKey: vi.fn().mockResolvedValue(null), normalizeOwnerKey: vi.fn().mockReturnValue(null) }));

// Import AFTER mocks are set up
const { POST } = await import("@/app/api/search/route");

interface SSEEvent {
  event: string;
  data: unknown;
}

async function readSSEStream(response: Response): Promise<SSEEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: SSEEvent[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ") && eventType) {
        events.push({ event: eventType, data: JSON.parse(line.slice(6)) });
        eventType = "";
      }
    }
  }

  return events;
}

describe("POST /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 429 when rate limited", async () => {
    mockRateLimit.mockResolvedValue({ ok: false, reason: "ip" });
    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "senior react, remote EU" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it("returns 400 for invalid JSON body", async () => {
    mockRateLimit.mockResolvedValue({ ok: true });
    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing query", async () => {
    mockRateLimit.mockResolvedValue({ ok: true });
    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("emits parsed → results → rerank → done events in order (cache miss)", async () => {
    mockRateLimit.mockResolvedValue({ ok: true });
    mockGetCachedSearch.mockResolvedValue(null);
    mockParseQuery.mockResolvedValue({ filters: { role: "react engineer", remote: true }, rawQuery: "senior react, remote EU" });
    mockSearchJobs.mockResolvedValue(fixtures);
    mockRerank.mockResolvedValue(rerankFixture);
    mockRerankWithMetrics.mockResolvedValue({ items: rerankFixture, tokens: 0 });
    mockCacheSearch.mockResolvedValue("cache-abc123");

    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "senior react, remote EU" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readSSEStream(res);

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toEqual(["parsed", "results", "rerank", "done"]);

    const parsedEvent = events[0];
    expect(parsedEvent.data).toEqual({ role: "react engineer", remote: true });

    const resultsEvent = events[1];
    expect(Array.isArray(resultsEvent.data)).toBe(true);
    expect((resultsEvent.data as Array<unknown>).length).toBe(fixtures.length);

    const rerankEvent = events[2];
    expect(Array.isArray(rerankEvent.data)).toBe(true);

    const doneEvent = events[3];
    expect(doneEvent.data).toEqual({ id: "cache-abc123" });
  });

  it("skips Exa search on cache hit and emits from cache", async () => {
    const cacheJobs = (fixtures as Array<{ id: string }>).slice(0, 3);
    const resultJobIds = cacheJobs.map((j: { id: string }) => j.id);
    mockRateLimit.mockResolvedValue({ ok: true });
    mockParseQuery.mockResolvedValue({ filters: { role: "react" }, rawQuery: "react jobs" });
    mockGetCachedSearch.mockResolvedValue({
      cache: {
        id: "cached-xyz",
        resultJobIds,
        rerankScores: Object.fromEntries(
          cacheJobs.map((j: { id: string }, i: number) => [j.id, { score: 0.9 - i * 0.2, fit: `Match ${i}` }]),
        ),
      },
      jobs: cacheJobs,
      resultJobIds,
    });

    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "react jobs" }),
    });

    const res = await POST(req);
    const events = await readSSEStream(res);

    expect(mockSearchJobs).not.toHaveBeenCalled();
    expect(events.map((e) => e.event)).toEqual(["parsed", "results", "rerank", "done"]);
  });

  it("handles rerank failure gracefully with fallback scores", async () => {
    mockRateLimit.mockResolvedValue({ ok: true });
    mockGetCachedSearch.mockResolvedValue(null);
    mockParseQuery.mockResolvedValue({ filters: { role: "engineer" }, rawQuery: "engineer" });
    mockSearchJobs.mockResolvedValue(fixtures);
    mockRerank.mockRejectedValue(new Error("Gemini timeout"));
    mockRerankWithMetrics.mockRejectedValue(new Error("Gemini timeout"));
    mockCacheSearch.mockResolvedValue("cache-fallback");

    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "engineer" }),
    });

    const res = await POST(req);
    const events = await readSSEStream(res);

    expect(events.map((e) => e.event)).toEqual(["parsed", "results", "rerank", "done"]);
    // Fallback: all items scored 0.5
    const rerankData = events[2].data as Array<{ idx: number; score: number }>;
    expect(rerankData.every((r) => r.score === 0.5)).toBe(true);
  });

  it("emits error event on Exa failure", async () => {
    mockRateLimit.mockResolvedValue({ ok: true });
    mockGetCachedSearch.mockResolvedValue(null);
    mockParseQuery.mockResolvedValue({ filters: { role: "dev" }, rawQuery: "dev" });
    mockSearchJobs.mockRejectedValue(new Error("Exa API error"));

    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "dev" }),
    });

    const res = await POST(req);
    const events = await readSSEStream(res);

    expect(events.length).toBe(2);
    expect(events[0].event).toBe("parsed");
    expect(events[1].event).toBe("error");
    expect(events[1].data).toEqual({ message: "Exa API error" });
  });

  it("accepts filters override (skips LLM parse, parseMs=0 path, uses provided filters via sanitize mock)", async () => {
    mockRateLimit.mockResolvedValue({ ok: true });
    mockGetCachedSearch.mockResolvedValue(null);
    mockSearchJobs.mockResolvedValue(fixtures.slice(0, 2));
    mockRerankWithMetrics.mockResolvedValue({ items: [{ idx: 0, score: 0.9, fit: "good" }], tokens: 10 });

    // Note: the route.test mocks sanitizeFilters as identity passthrough (see top of file).
    // Real sanitize trims/floors/caps; here we just prove the override branch was taken
    // (no parseQuery LLM call) and the filters we sent reached the "parsed" SSE event.
    const overrideFilters = { role: "  senior engineer  ", remote: true, salaryMin: 123456.7, exclude: ["crypto", "blockchain"] };
    const req = new NextRequest("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "ignored when filters provided", filters: overrideFilters }),
    });

    const res = await POST(req);
    const events = await readSSEStream(res);

    const parsedEvent = events.find((e) => e.event === "parsed");
    expect(parsedEvent).toBeTruthy();
    // Under test mock, we get back (essentially) what we sent in the override.
    expect(parsedEvent!.data).toMatchObject({
      role: "  senior engineer  ",
      remote: true,
      salaryMin: 123456.7,
      exclude: ["crypto", "blockchain"],
    });

    // Crucially, the LLM parse path was not exercised for this request.
    // (parseQuery mock is cleared per test via beforeEach + we didn't hit the else branch.)
    expect(mockParseQuery).not.toHaveBeenCalled();

    // downstream still works (results + rerank + done)
    expect(events.some((e) => e.event === "results")).toBe(true);
    expect(events.some((e) => e.event === "rerank")).toBe(true);
    expect(events.some((e) => e.event === "done")).toBe(true);
  });
});
