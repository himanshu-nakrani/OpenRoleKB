import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
vi.mock("@/lib/llm", () => ({
  getLLM: () => ({
    chat: { completions: { create: mockCreate } },
  }),
}));

const { rerankWithMetrics, rerank } = await import("@/lib/rerank");

function mockLLMResponse(args: object, tokens = 1234) {
  mockCreate.mockResolvedValue({
    usage: { total_tokens: tokens },
    choices: [{
      message: {
        tool_calls: [{
          type: "function",
          function: { name: "rate_results", arguments: JSON.stringify(args) },
        }],
      },
    }],
  });
}

const results = Array.from({ length: 5 }, (_, i) => ({
  id: `j${i}`,
  title: `Job ${i}`,
  url: `https://example.com/${i}`,
  text: `desc ${i}`,
  highlights: [],
}));

describe("rerankWithMetrics", () => {
  beforeEach(() => mockCreate.mockReset());

  it("returns items + tokens from usage", async () => {
    mockLLMResponse({
      results: [
        { idx: 0, score: 0.9, fit: "great" },
        { idx: 1, score: 0.6, fit: "ok" },
      ],
    }, 2500);

    const r = await rerankWithMetrics("q", results);
    expect(r.tokens).toBe(2500);
    expect(r.items[0]).toEqual({ idx: 0, score: 0.9, fit: "great" });
  });

  it("clamps out-of-range scores to 0.5", async () => {
    mockLLMResponse({
      results: [
        { idx: 0, score: 1.5, fit: "" },
        { idx: 1, score: -0.2, fit: "" },
        { idx: 2, score: 0.7, fit: "" },
      ],
    });
    const r = await rerankWithMetrics("q", results);
    const byIdx = new Map(r.items.map((it) => [it.idx, it.score]));
    expect(byIdx.get(0)).toBe(0.5);
    expect(byIdx.get(1)).toBe(0.5);
    expect(byIdx.get(2)).toBe(0.7);
  });

  it("drops hallucinated out-of-range indices", async () => {
    mockLLMResponse({
      results: [
        { idx: 0, score: 0.9, fit: "" },
        { idx: 99, score: 0.8, fit: "" },
        { idx: -1, score: 0.7, fit: "" },
        { idx: 2.5, score: 0.7, fit: "" },
      ],
    });
    const r = await rerankWithMetrics("q", results);
    expect(r.items.length).toBe(1);
    expect(r.items[0].idx).toBe(0);
  });

  it("truncates oversized fit strings to 120 chars", async () => {
    mockLLMResponse({
      results: [{ idx: 0, score: 0.9, fit: "x".repeat(500) }],
    });
    const r = await rerankWithMetrics("q", results);
    expect(r.items[0].fit.length).toBe(120);
  });

  it("returns empty for empty input", async () => {
    const r = await rerankWithMetrics("q", []);
    expect(r.items).toEqual([]);
    expect(r.tokens).toBeUndefined();
  });

  it("returns single result with score 1.0 for single input", async () => {
    const r = await rerankWithMetrics("q", [results[0]]);
    expect(r.items).toEqual([{ idx: 0, score: 1.0, fit: "Only result available" }]);
  });

  it("returns sorted descending by score", async () => {
    mockLLMResponse({
      results: [
        { idx: 0, score: 0.3, fit: "" },
        { idx: 1, score: 0.9, fit: "" },
        { idx: 2, score: 0.7, fit: "" },
      ],
    });
    const r = await rerankWithMetrics("q", results);
    expect(r.items.map((it) => it.score)).toEqual([0.9, 0.7, 0.3]);
  });

  it("falls back to uniform 0.5 scores when tool call is missing", async () => {
    mockCreate.mockResolvedValue({
      usage: { total_tokens: 100 },
      choices: [{ message: { tool_calls: [] } }],
    });
    const r = await rerankWithMetrics("q", results);
    expect(r.items.length).toBe(results.length);
    expect(r.items.every((it) => it.score === 0.5)).toBe(true);
  });
});

describe("rerank (legacy wrapper)", () => {
  beforeEach(() => mockCreate.mockReset());

  it("returns just the items array", async () => {
    mockLLMResponse({
      results: [{ idx: 0, score: 0.9, fit: "ok" }],
    });
    const items = await rerank("q", results);
    expect(Array.isArray(items)).toBe(true);
    expect(items[0]).toEqual({ idx: 0, score: 0.9, fit: "ok" });
  });
});
