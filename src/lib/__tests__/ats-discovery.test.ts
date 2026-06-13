import { describe, expect, it } from "vitest";
import { dedupeCandidates, extractCandidateFromUrl, extractCandidatesFromText } from "@/lib/ats-discovery";

describe("ATS discovery slug extraction", () => {
  it("extracts Greenhouse slugs", () => {
    expect(extractCandidateFromUrl("https://boards.greenhouse.io/phonepe/jobs/123")!).toMatchObject({ ats: "greenhouse", slug: "phonepe" });
    expect(extractCandidateFromUrl("https://job-boards.greenhouse.io/HighRadius/jobs/123")!).toMatchObject({ ats: "greenhouse", slug: "highradius" });
    expect(extractCandidateFromUrl("https://boards-api.greenhouse.io/v1/boards/GitLab/jobs")!).toMatchObject({ ats: "greenhouse", slug: "gitlab" });
  });

  it("extracts Lever slugs", () => {
    expect(extractCandidateFromUrl("https://jobs.lever.co/meesho/abc-def")!).toMatchObject({ ats: "lever", slug: "meesho" });
    expect(extractCandidateFromUrl("https://api.lever.co/v0/postings/CRED?mode=json")!).toMatchObject({ ats: "lever", slug: "cred" });
  });

  it("extracts Ashby slugs", () => {
    expect(extractCandidateFromUrl("https://jobs.ashbyhq.com/scaler/role-id")!).toMatchObject({ ats: "ashby", slug: "scaler" });
    expect(extractCandidateFromUrl("https://api.ashbyhq.com/posting-api/job-board/Navi")!).toMatchObject({ ats: "ashby", slug: "navi" });
  });

  it("extracts SmartRecruiters slugs", () => {
    expect(extractCandidateFromUrl("https://jobs.smartrecruiters.com/Freshworks/123-engineer")!).toMatchObject({ ats: "smartrecruiters", slug: "freshworks" });
    expect(extractCandidateFromUrl("https://api.smartrecruiters.com/v1/companies/Unacademy/postings")!).toMatchObject({ ats: "smartrecruiters", slug: "unacademy" });
  });

  it("dedupes by ats and slug", () => {
    expect(dedupeCandidates([
      { ats: "greenhouse", slug: "phonepe", source: "exa" },
      { ats: "greenhouse", slug: "phonepe", source: "hint" },
      { ats: "lever", slug: "phonepe", source: "exa" },
    ])).toEqual([
      { ats: "greenhouse", slug: "phonepe", source: "exa" },
      { ats: "lever", slug: "phonepe", source: "exa" },
    ]);
  });

  it("extracts candidates from fixture HTML/text", () => {
    const html = `
      <a href="https://boards.greenhouse.io/postman/jobs/123">Postman</a>
      <a href="https://jobs.lever.co/Meesho/abc">Meesho</a>
      <a href="https://jobs.ashbyhq.com/ditto/role">Ditto</a>
      <a href="https://jobs.smartrecruiters.com/Cars24/123">Cars24</a>
    `;
    expect(extractCandidatesFromText(html, "sitemap").map((c) => `${c.ats}:${c.slug}`)).toEqual([
      "greenhouse:postman",
      "lever:meesho",
      "ashby:ditto",
      "smartrecruiters:cars24",
    ]);
  });
});
