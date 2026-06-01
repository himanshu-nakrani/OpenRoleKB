import { describe, it, expect } from "vitest";
import { extractCompany } from "@/lib/company";

describe("extractCompany", () => {
  it("extracts company from greenhouse.io URL", () => {
    expect(extractCompany("https://boards.greenhouse.io/acmerobotics/jobs/12345")).toBe("acmerobotics");
  });

  it("extracts company from lever.co URL", () => {
    expect(extractCompany("https://jobs.lever.co/superhuman/abc-def")).toBe("superhuman");
  });

  it("extracts company from ashbyhq.com URL", () => {
    expect(extractCompany("https://jobs.ashbyhq.com/notion/some-id")).toBe("notion");
  });

  it("extracts company from workable.com URL", () => {
    expect(extractCompany("https://apply.workable.com/automattic/j/ABC123/")).toBe("automattic");
  });

  it("returns null for linkedin.com URL", () => {
    expect(extractCompany("https://www.linkedin.com/jobs/view/9999")).toBeNull();
  });

  it("returns null for malformed URL, no throw", () => {
    expect(extractCompany("not-a-url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractCompany("")).toBeNull();
  });

  it("handles URL without path segments", () => {
    expect(extractCompany("https://boards.greenhouse.io/")).toBeNull();
  });

  // Phase 7: new ATS hosts
  it("extracts company from myworkdayjobs.com URL", () => {
    expect(extractCompany("https://acmerobotics.myworkdayjobs.com/en-US/External/job/Senior-Engineer")).toBe("acmerobotics");
  });

  it("extracts company from smartrecruiters.com URL", () => {
    expect(extractCompany("https://notion.smartrecruiters.com/")).toBe("notion");
  });

  it("extracts company from bamboohr.com URL", () => {
    expect(extractCompany("https://gusto.bamboohr.com/careers/123")).toBe("gusto");
  });

  it("extracts company from recruitee.com URL", () => {
    expect(extractCompany("https://opencareers.recruitee.com/o/senior-frontend")).toBe("opencareers");
  });

  it("extracts company from personio.de URL", () => {
    expect(extractCompany("https://acme.personio.de/recruiting/positions/1")).toBe("acme");
  });

  it("extracts company from teamtailor.com URL", () => {
    expect(extractCompany("https://jobs.linear.teamtailor.com/jobs/123")).toBe("linear");
  });
});
