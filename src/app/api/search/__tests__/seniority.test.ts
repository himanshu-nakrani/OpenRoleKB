import { describe, it, expect, vi } from "vitest";

// Match the auto-mocks the other tests in this dir install so the route
// module's heavy imports don't blow up on collection.
vi.mock("@/lib/parse-query", () => ({ parseQuery: vi.fn(), sanitizeFilters: (x: unknown) => x }));
vi.mock("@/lib/exa", () => ({ searchJobsWithReport: vi.fn() }));
vi.mock("@/lib/cache", () => ({
  cacheSearch: vi.fn(),
  getCachedSearch: vi.fn().mockResolvedValue(null),
  getCachedSearchByRawQuery: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/rerank", () => ({ rerankWithMetrics: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/owner", () => ({ getOwnerKey: vi.fn() }));
vi.mock("@/lib/observe", () => ({ captureRouteError: vi.fn() }));

const { titleContradictsSeniority } = await import("../route");

describe("titleContradictsSeniority", () => {
  it("rejects Senior/Staff/Lead titles when user wants junior", () => {
    expect(titleContradictsSeniority("Senior Software Engineer", "junior")).toBe(true);
    expect(titleContradictsSeniority("Staff Product Manager", "junior")).toBe(true);
    expect(titleContradictsSeniority("Engineering Lead", "junior")).toBe(true);
    expect(titleContradictsSeniority("Principal Designer", "junior")).toBe(true);
    expect(titleContradictsSeniority("Director, Product", "junior")).toBe(true);
    expect(titleContradictsSeniority("VP Engineering", "junior")).toBe(true);
    expect(titleContradictsSeniority("Sr. Frontend Engineer", "junior")).toBe(true);
  });

  it("keeps junior/associate/grad titles when user wants junior", () => {
    expect(titleContradictsSeniority("Junior Software Engineer", "junior")).toBe(false);
    expect(titleContradictsSeniority("Associate Product Manager", "junior")).toBe(false);
    expect(titleContradictsSeniority("Software Engineer I", "junior")).toBe(false);
    expect(titleContradictsSeniority("Graduate Engineer", "junior")).toBe(false);
    expect(titleContradictsSeniority("Software Engineer", "junior")).toBe(false); // unmarked title — let it through
  });

  it("rejects junior/intern titles when user wants senior+", () => {
    expect(titleContradictsSeniority("Junior Backend Engineer", "senior")).toBe(true);
    expect(titleContradictsSeniority("Software Engineering Intern", "senior")).toBe(true);
    expect(titleContradictsSeniority("Associate Product Manager", "staff")).toBe(true);
    expect(titleContradictsSeniority("Engineer I", "principal")).toBe(true);
  });

  it("keeps senior+ titles when user wants senior+", () => {
    expect(titleContradictsSeniority("Senior Software Engineer", "senior")).toBe(false);
    expect(titleContradictsSeniority("Staff Engineer", "senior")).toBe(false);
    expect(titleContradictsSeniority("Senior Software Engineer", "staff")).toBe(false);
  });

  it("does not filter when seniority is mid or unknown", () => {
    expect(titleContradictsSeniority("Senior Engineer", "mid")).toBe(false);
    expect(titleContradictsSeniority("Junior Engineer", "mid")).toBe(false);
    expect(titleContradictsSeniority("Senior Engineer", "")).toBe(false);
  });

  it("is case-insensitive and tolerates extra whitespace", () => {
    expect(titleContradictsSeniority("  SENIOR  Engineer  ", "junior")).toBe(true);
    expect(titleContradictsSeniority("junior dev", "senior")).toBe(true);
  });
});
