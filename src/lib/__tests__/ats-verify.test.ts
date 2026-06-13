import { describe, expect, it, vi } from "vitest";
import { __test__, verifyTenant } from "@/lib/ats-verify";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("verifyTenant", () => {
  it("marks 404 as dead", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    const result = await verifyTenant("greenhouse", "missing", { fetchImpl });
    expect(result).toMatchObject({ ok: false, status: "dead", error: "HTTP 404" });
  });

  it("marks 429 as rate_limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, {}));
    const result = await verifyTenant("lever", "busy", { fetchImpl });
    expect(result).toMatchObject({ ok: false, status: "rate_limited", error: "HTTP 429" });
  });

  it("returns candidate for network/other errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await verifyTenant("ashby", "flaky", { fetchImpl });
    expect(result).toMatchObject({ ok: false, status: "candidate", error: "ECONNRESET" });
  });

  it("verifies Greenhouse and detects Indian jobs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      jobs: [
        { title: "AI Engineer", location: { name: "Hyderabad, Telangana" }, company_name: "Acme" },
        { title: "Backend Engineer", location: { name: "Berlin" }, company_name: "Acme" },
      ],
    }));
    const result = await verifyTenant("greenhouse", "acme", { fetchImpl });
    expect(result).toMatchObject({ ok: true, status: "verified", jobCount: 2, hasIndianJobs: true, companyName: "Acme" });
    expect(result.sampleTitles).toEqual(["AI Engineer", "Backend Engineer"]);
  });

  it("normalizes all ATS payload shapes", async () => {
    expect(__test__.normalizeJobs("lever", [{ text: "SDE", categories: { location: "Bengaluru" } }]).jobs[0]).toEqual({ title: "SDE", location: "Bengaluru" });
    expect(__test__.normalizeJobs("ashby", { jobs: [{ title: "PM", location: "Mumbai" }], jobBoard: { name: "X" } })).toMatchObject({ companyName: "X" });
    expect(__test__.normalizeJobs("smartrecruiters", { content: [{ name: "QA", location: { city: "Pune", country: "India" } }] }).jobs[0]).toEqual({ title: "QA", location: "Pune, India" });
  });

  it("detects Indian geo aliases", () => {
    expect(__test__.hasIndiaGeo("Bangalore, Karnataka")).toBe(true);
    expect(__test__.hasIndiaGeo("Gurugram")).toBe(true);
    expect(__test__.hasIndiaGeo("Remote, India")).toBe(true);
    expect(__test__.hasIndiaGeo("London, UK")).toBe(false);
  });
});
