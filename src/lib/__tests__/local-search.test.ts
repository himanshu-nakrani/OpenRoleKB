import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted to top of file by vitest, so we can't reference a
// const defined in module scope from the factory. vi.hoisted() returns a
// value that *is* hoisted alongside vi.mock, so we can share the spy.
const { mockQueryRaw } = vi.hoisted(() => ({ mockQueryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: mockQueryRaw } }));

import { searchLocalJobs } from "@/lib/local-search";

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "j1",
    url: "https://job-boards.greenhouse.io/stripe/jobs/1",
    title: "Senior Rust Engineer",
    company: "Stripe",
    location: "Remote, US",
    isRemote: true,
    description: "Build payments infra in Rust.",
    publishedAt: new Date("2026-06-01"),
    salaryMinUsd: 180000,
    salaryMaxUsd: 250000,
    salaryRaw: "$180k-$250k",
    lastSeenAt: new Date("2026-06-06"),
    rank: 0.95,
    ...over,
  };
}

describe("searchLocalJobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty result when no useful tokens", async () => {
    const out = await searchLocalJobs({});
    expect(out.results).toEqual([]);
    expect(out.rawHits).toBe(0);
    expect(out.tsquery).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("builds an AND-joined tsquery from role + seniority + skills", async () => {
    mockQueryRaw.mockResolvedValue([row()]);
    const out = await searchLocalJobs({
      role: "rust engineer",
      seniority: "senior",
      skills: ["payments", "rust"],
    });
    expect(out.tsquery).toBe("rust & engineer & senior & payments");
    expect(out.rawHits).toBe(1);
    expect(out.results[0].title).toBe("Senior Rust Engineer");
  });

  it("dedupes tokens so a skill repeated in role doesn't duplicate", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const out = await searchLocalJobs({ role: "rust", skills: ["Rust"] });
    expect(out.tsquery).toBe("rust");
  });

  it("strips punctuation and short tokens", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const out = await searchLocalJobs({ role: "C/C++ backend" });
    // "c" is single-char (dropped); "c" again dropped; "backend" kept
    expect(out.tsquery).toBe("backend");
  });

  it("post-filters out isRemote=false when user asked for remote", async () => {
    mockQueryRaw.mockResolvedValue([
      row({ id: "j1", isRemote: true }),
      row({ id: "j2", isRemote: false }),
      row({ id: "j3", isRemote: null }), // unknown — kept
    ]);
    const out = await searchLocalJobs({ role: "engineer", remote: true });
    expect(out.results.map((r) => r.id)).toEqual(["j1", "j3"]);
  });

  it("does NOT filter by isRemote when user didn't ask for remote", async () => {
    mockQueryRaw.mockResolvedValue([
      row({ id: "j1", isRemote: true }),
      row({ id: "j2", isRemote: false }),
    ]);
    const out = await searchLocalJobs({ role: "engineer" });
    expect(out.results.map((r) => r.id)).toEqual(["j1", "j2"]);
  });

  it("maps row fields to ExaResult shape", async () => {
    mockQueryRaw.mockResolvedValue([row()]);
    const out = await searchLocalJobs({ role: "engineer" });
    const r = out.results[0];
    expect(r.id).toBe("j1");
    expect(r.url).toContain("greenhouse.io");
    expect(r.text).toContain("Rust");
    expect(r.salaryRaw).toBe("$180k-$250k");
    expect(r.publishedDate).toBe(new Date("2026-06-01").toISOString());
    expect(r.lastSeenAt).toBe(new Date("2026-06-06").toISOString());
  });

  it("backfills salary from description when ingest missed it", async () => {
    mockQueryRaw.mockResolvedValue([
      row({
        salaryMinUsd: null,
        salaryMaxUsd: null,
        salaryRaw: null,
        description: "We pay $150,000 - $200,000 per year.",
      }),
    ]);
    const out = await searchLocalJobs({ role: "engineer" });
    expect(out.results[0].salaryMinUsd).toBeGreaterThan(0);
  });
});
