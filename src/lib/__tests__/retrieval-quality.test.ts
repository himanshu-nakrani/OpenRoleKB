import { describe, it, expect } from "vitest";
import { assessResult, filterResults, hasJobPostingSchema } from "@/lib/retrieval-quality";
import type { ExaResult } from "@/types/job";

function r(url: string, text = ""): ExaResult {
  return { id: url, title: "t", url, text, highlights: [] };
}

describe("retrieval-quality URL classifier", () => {
  it("flags Ashby blog/resource paths as marketing", () => {
    const reasons = (url: string) => assessResult(r(url)).quality.rejectionReasons;
    expect(reasons("https://www.ashbyhq.com/blog/engineering/ai-ashby")).toContain("denylist_path");
    expect(reasons("https://www.ashbyhq.com/resources/engineer-technical-challenge")).toContain("denylist_path");
    expect(reasons("https://www.ashbyhq.com/customers/posthog-customer-story")).toContain("denylist_path");
    expect(reasons("https://www.ashbyhq.com/podcast/episodes/foo")).toContain("denylist_path");
    expect(reasons("https://www.ashbyhq.com/team/engineering")).toContain("denylist_path");
    expect(reasons("https://www.ashbyhq.com/product-updates/foo")).toContain("denylist_path");
  });

  it("flags Workable post-jobs template pages as marketing", () => {
    expect(assessResult(r("https://www.workable.com/post-jobs-for-free/customize?wid=287")).quality.rejectionReasons)
      .toContain("denylist_path");
  });

  it("classifies real ATS job URLs as individual_job", () => {
    expect(assessResult(r("https://boards.greenhouse.io/airbnb/jobs/7649441")).quality.urlClass).toBe("individual_job");
    expect(assessResult(r("https://jobs.ashbyhq.com/Notion/abc123-def-456")).quality.urlClass).toBe("individual_job");
    expect(assessResult(r("https://jobs.lever.co/stripe/8a3f4b9c-1234")).quality.urlClass).toBe("individual_job");
    expect(assessResult(r("https://apply.workable.com/canva/j/ABCDEF/")).quality.urlClass).toBe("individual_job");
    expect(assessResult(r("https://acme.myworkdayjobs.com/External/job/SF/Engineer_R123")).quality.urlClass).toBe("individual_job");
  });

  it("classifies ATS-host root or careers landing pages as company_careers_listing", () => {
    const q = assessResult(r("https://jobs.ashbyhq.com/Notion")).quality;
    expect(q.urlClass).toBe("company_careers_listing");
    expect(q.rejectionReasons).toContain("ats_url_not_individual_job");
  });

  it("returns 'unknown' for non-ATS hosts with no denylist hit", () => {
    expect(assessResult(r("https://stripe.com/jobs/some-role")).quality.urlClass).toBe("unknown");
  });

  it("rejects malformed URLs as 'unknown' rather than throwing", () => {
    expect(() => assessResult(r("not a url"))).not.toThrow();
    expect(assessResult(r("not a url")).quality.urlClass).toBe("unknown");
  });
});

describe("retrieval-quality JSON-LD detector", () => {
  it("detects JobPosting in JSON-LD blob", () => {
    expect(hasJobPostingSchema('{"@context":"https://schema.org","@type":"JobPosting","title":"x"}')).toBe(true);
  });

  it("detects JobPosting in @type array", () => {
    expect(hasJobPostingSchema('"@type": ["Thing","JobPosting"]')).toBe(true);
  });

  it("detects microdata itemtype", () => {
    expect(hasJobPostingSchema('<div itemtype="https://schema.org/JobPosting">')).toBe(true);
  });

  it("returns false on empty/undefined input", () => {
    expect(hasJobPostingSchema(undefined)).toBe(false);
    expect(hasJobPostingSchema("")).toBe(false);
  });

  it("returns false for unrelated structured data", () => {
    expect(hasJobPostingSchema('{"@type":"Article"}')).toBe(false);
  });
});

describe("filterResults", () => {
  it("drops denylisted URLs and keeps individual job pages", () => {
    const input: ExaResult[] = [
      r("https://www.ashbyhq.com/blog/engineering/foo"),
      r("https://boards.greenhouse.io/airbnb/jobs/7649441"),
      r("https://jobs.ashbyhq.com/Notion/abc123"),
      r("https://www.workable.com/post-jobs-for-free/customize?wid=287"),
    ];
    const report = filterResults(input);
    expect(report.kept).toHaveLength(2);
    expect(report.rejected).toHaveLength(2);
    expect(report.counts.kept).toBe(2);
    expect(report.counts.denylist_path).toBe(2);
  });

  it("keeps unknown/ats-listing URLs in the kept set", () => {
    const input: ExaResult[] = [
      r("https://jobs.ashbyhq.com/Notion"),
      r("https://random.example.com/page"),
    ];
    const report = filterResults(input);
    expect(report.kept).toHaveLength(2);
    expect(report.counts.ats_url_not_individual_job).toBe(1);
  });
});
