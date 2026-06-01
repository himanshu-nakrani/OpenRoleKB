import { describe, it, expect } from "vitest";
import { sanitizeFilters } from "@/lib/parse-query";

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
