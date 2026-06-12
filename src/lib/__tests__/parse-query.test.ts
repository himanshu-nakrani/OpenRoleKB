import { beforeEach, describe, it, expect, vi } from "vitest";

const { mockCreate, mockWarn } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  getLLM: () => ({ chat: { completions: { create: mockCreate } } }),
  getLLMModel: () => "gemini-flash-latest",
  getLLMReasoningEffort: () => "none",
}));
vi.mock("@/lib/logger", () => ({ log: { warn: mockWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import { sanitizeFilters, parseQuery } from "@/lib/parse-query";

beforeEach(() => {
  mockCreate.mockReset();
  mockWarn.mockReset();
  mockCreate.mockRejectedValue(new Error("LLM unavailable"));
});

describe("sanitizeFilters", () => {
  it("returns empty filters for non-object input", () => {
    expect(sanitizeFilters(null)).toEqual({});
    expect(sanitizeFilters("garbage" as unknown)).toEqual({});
    expect(sanitizeFilters(42 as unknown)).toEqual({});
  });

  it("keeps a clean string role", () => {
    expect(sanitizeFilters({ role: "senior react engineer" })).toEqual({
      role: "senior react engineer",
    });
  });

  it("trims and length-caps role", () => {
    const r = sanitizeFilters({ role: "  " + "x".repeat(500) + "  " });
    expect(r.role!.length).toBe(200);
  });

  it("rejects non-string role", () => {
    expect(sanitizeFilters({ role: 123 })).toEqual({});
    expect(sanitizeFilters({ role: [] })).toEqual({});
  });

  it("strips empty role string", () => {
    expect(sanitizeFilters({ role: "   " })).toEqual({});
  });

  it("rejects salaryMin as string", () => {
    expect(sanitizeFilters({ salaryMin: "120k" })).toEqual({});
  });

  it("accepts and floors yearsExperience", () => {
    expect(sanitizeFilters({ yearsExperience: 3.9 })).toEqual({ yearsExperience: 3 });
    expect(sanitizeFilters({ yearsExperience: "3" })).toEqual({});
  });

  it("rejects negative salaryMin", () => {
    expect(sanitizeFilters({ salaryMin: -1 })).toEqual({});
  });

  it("floors fractional salaryMin", () => {
    expect(sanitizeFilters({ salaryMin: 99999.99 })).toEqual({ salaryMin: 99999 });
  });

  it("rejects NaN / Infinity in salaryMin", () => {
    expect(sanitizeFilters({ salaryMin: NaN })).toEqual({});
    expect(sanitizeFilters({ salaryMin: Infinity })).toEqual({});
  });

  it("filters skills array to strings only, caps length to 20", () => {
    expect(sanitizeFilters({ skills: ["react", 1, null, "ts", "tw"] })).toEqual({
      skills: ["react", "ts", "tw"],
    });
    const many = Array.from({ length: 30 }, (_, i) => `s${i}`);
    expect(sanitizeFilters({ skills: many }).skills?.length).toBe(20);
  });

  it("rejects non-array skills", () => {
    expect(sanitizeFilters({ skills: "react,ts" })).toEqual({});
  });

  it("clamps freshnessDays to 365 max", () => {
    expect(sanitizeFilters({ freshnessDays: 9999 })).toEqual({ freshnessDays: 365 });
  });

  it("rejects negative or zero freshnessDays", () => {
    expect(sanitizeFilters({ freshnessDays: -5 })).toEqual({});
    expect(sanitizeFilters({ freshnessDays: 0 })).toEqual({});
  });

  it("accepts boolean remote", () => {
    expect(sanitizeFilters({ remote: true })).toEqual({ remote: true });
    expect(sanitizeFilters({ remote: false })).toEqual({ remote: false });
  });

  it("rejects remote as string truthy", () => {
    expect(sanitizeFilters({ remote: "yes" })).toEqual({});
  });

  it("preserves multiple valid fields", () => {
    expect(
      sanitizeFilters({
        role: "engineer",
        seniority: "senior",
        skills: ["rust", "wasm"],
        remote: true,
        freshnessDays: 30,
        location: "EU",
      }),
    ).toEqual({
      role: "engineer",
      seniority: "senior",
      skills: ["rust", "wasm"],
      remote: true,
      freshnessDays: 30,
      location: "EU",
    });
  });

  it("ignores unknown fields", () => {
    expect(sanitizeFilters({ role: "engineer", malicious: { drop: "table" } })).toEqual({
      role: "engineer",
    });
  });

  it("does not throw on prototype pollution attempts", () => {
    const evil: Record<string, unknown> = { role: "x" };
    evil["__proto__"] = { polluted: true };
    expect(() => sanitizeFilters(evil)).not.toThrow();
  });
});

describe("parseQuery fast-path", () => {
  it("fast-paths simple role-only queries without LLM", async () => {
    const result = await parseQuery("react engineer");
    expect(result.filters).toEqual({ role: "react engineer" });
    expect(result.tokens).toBe(0);
    expect(result.parseError).toBeUndefined();
  });

  it("fast-paths short queries without filter keywords", async () => {
    const result = await parseQuery("python developer");
    expect(result.filters.role).toBe("python developer");
    expect(result.tokens).toBe(0);
  });

  it("still uses LLM for queries with filter triggers (remote, senior, etc.)", async () => {
    const result = await parseQuery("senior react remote eu");
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.filters.role).toBeDefined();
  });


  it("degrades the Hyderabad years regression without an LLM call", async () => {
    const result = await parseQuery("ai engineer role in hyderabad for 3 years of experience");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.tokens).toBe(0);
    expect(result.filters).toEqual({
      role: "ai engineer",
      location: "Hyderabad",
      yearsExperience: 3,
    });
  });

  it("logs parse errors at warn level and returns degraded filters", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Gemini timeout"));
    const result = await parseQuery("senior backend engineer in bangalore");
    expect(mockWarn).toHaveBeenCalledWith({ evt: "parse_error", parseError: "Gemini timeout" });
    expect(result.parseError).toBe("Gemini timeout");
    expect(result.filters).toMatchObject({ role: "senior backend engineer", location: "Bengaluru" });
  });

  it("fast-paths very short clean role queries", async () => {
    const result = await parseQuery("dev");
    expect(result.filters).toEqual({ role: "dev" });
    expect(result.tokens).toBe(0);
  });
});
