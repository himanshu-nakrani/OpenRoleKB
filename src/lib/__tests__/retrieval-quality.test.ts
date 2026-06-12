import { describe, it, expect } from "vitest";
import { assessResult, filterResults, hasJobPostingSchema, isTitleDenylisted, stripLocalePrefix } from "@/lib/retrieval-quality";
import type { ExaResult } from "@/types/job";

function r(url: string, text = "", title = "t"): ExaResult {
  return { id: url, title, url, text, highlights: [] };
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

  it("flags about-us, leadership, author, press, events, webinars, integrations paths", () => {
    const reasons = (url: string) => assessResult(r(url)).quality.rejectionReasons;
    // about-us — the observed SmartRecruiters bug
    expect(reasons("https://www.smartrecruiters.com/about-us/leadership/michal-nowak")).toContain("denylist_path");
    // locale-prefixed: /de/about-us/ should still match
    expect(reasons("https://www.smartrecruiters.com/de/about-us/leadership/michal-nowak")).toContain("denylist_path");
    expect(reasons("https://lever.co/blog/author/jonathan-milne")).toContain("denylist_path");
    expect(reasons("https://www.bamboohr.com/blog/crafting-compelling-ai-job-posts")).toContain("denylist_path");
    expect(reasons("https://www.teamtailor.com/integrations/naukri-india")).toContain("denylist_path");
    expect(reasons("https://example.com/press/foo")).toContain("denylist_path");
    expect(reasons("https://example.com/events/webinar")).toContain("denylist_path");
    expect(reasons("https://example.com/webinars/foo")).toContain("denylist_path");
    expect(reasons("https://example.com/partners/foo")).toContain("denylist_path");
    expect(reasons("https://example.com/case-studies/foo")).toContain("denylist_path");
  });

  it("flags vendor-own BambooHR and Lever careers pages as marketing", () => {
    const reasons = (url: string) => assessResult(r(url)).quality.rejectionReasons;
    // bamboohr.com/careers/* is the vendor's own careers page, not a customer job
    expect(reasons("https://www.bamboohr.com/careers/engineering-it")).toContain("denylist_path");
    expect(reasons("https://bamboohr.com/careers/")).toContain("denylist_path");
    // lever.co/careers/* is the vendor's own hiring page
    expect(reasons("https://www.lever.co/careers/")).toContain("denylist_path");
    expect(reasons("https://lever.co/careers/account-executive")).toContain("denylist_path");
  });

  it("classifies real ATS job URLs as individual_job (NEGATIVE: must SURVIVE filter)", () => {
    // Real SmartRecruiters job posting on the customer-facing jobs subdomain
    // (pattern: jobs.smartrecruiters.com/{company}/{numeric_id})
    expect(assessResult(r("https://jobs.smartrecruiters.com/Stripe/123456789")).quality.urlClass).toBe("individual_job");
    // Real Lever posting on jobs.lever.co subdomain
    expect(assessResult(r("https://jobs.lever.co/stripe/8a3f4b9c-1234")).quality.urlClass).toBe("individual_job");
    // Real BambooHR tenant posting (tenant subdomain, not bamboohr.com main)
    expect(assessResult(r("https://acme.bamboohr.com/careers/12345")).quality.urlClass).toBe("individual_job");
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

describe("stripLocalePrefix", () => {
  it("strips 2-letter locale prefix", () => {
    expect(stripLocalePrefix("/de/about-us/foo")).toBe("/about-us/foo");
    expect(stripLocalePrefix("/fr/careers/bar")).toBe("/careers/bar");
  });

  it("strips lang-region locale prefix", () => {
    expect(stripLocalePrefix("/en-us/blog/post")).toBe("/blog/post");
    expect(stripLocalePrefix("/zh-CN/about/team")).toBe("/about/team");
  });

  it("does NOT strip non-locale paths", () => {
    expect(stripLocalePrefix("/careers/engineer")).toBe("/careers/engineer");
    expect(stripLocalePrefix("/about-us/leadership")).toBe("/about-us/leadership");
  });

  it("does NOT strip job-like paths that start with 2 letter segments", () => {
    // /uk/ is a 2-letter prefix — this is acceptable collateral; but actual job
    // paths like /jobs/123 are untouched
    expect(stripLocalePrefix("/jobs/12345")).toBe("/jobs/12345");
  });
});

describe("isTitleDenylisted", () => {
  it("rejects vendor-brand suffix with no role token", () => {
    // Leadership bio — no role token → should be rejected
    expect(isTitleDenylisted("Michał Nowak | SmartRecruiters")).toBe(true);
    expect(isTitleDenylisted("John Smith | Lever")).toBe(true);
    expect(isTitleDenylisted("Engineering & IT Careers | BambooHR")).toBe(false); // "engineer" token present? No — but "careers" isn't in our list; check below
  });

  it("NEGATIVE: preserves real postings with role token + vendor suffix", () => {
    expect(isTitleDenylisted("Software Engineer | SmartRecruiters")).toBe(false);
    expect(isTitleDenylisted("Senior Backend Developer | Lever")).toBe(false);
    expect(isTitleDenylisted("Engineering Manager | BambooHR")).toBe(false);
    expect(isTitleDenylisted("Product Manager | Teamtailor")).toBe(false);
  });

  it("rejects author attribution pages", () => {
    expect(isTitleDenylisted("Jonathan Milne — Author at Lever")).toBe(true);
    expect(isTitleDenylisted("Author at BambooHR")).toBe(true);
  });

  it("rejects expired posting notices", () => {
    expect(isTitleDenylisted("This job ad has expired")).toBe(true);
    expect(isTitleDenylisted("This position is no longer accepting applications")).toBe(true);
    expect(isTitleDenylisted("Job no longer available")).toBe(true);
  });

  it("returns false for undefined/empty title", () => {
    expect(isTitleDenylisted(undefined)).toBe(false);
    expect(isTitleDenylisted("")).toBe(false);
  });

  it("returns false for normal job posting titles", () => {
    expect(isTitleDenylisted("Senior Backend Engineer at Stripe")).toBe(false);
    expect(isTitleDenylisted("Crafting Compelling AI Job Posts")).toBe(false); // BambooHR blog title — caught by URL path, not title
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

  it("drops results with denylist_title reasons", () => {
    const input: ExaResult[] = [
      r("https://www.smartrecruiters.com/some-page", "", "Michał Nowak | SmartRecruiters"),
      r("https://jobs.lever.co/acme/abc123", "", "Backend Engineer | Lever"),
    ];
    const report = filterResults(input);
    expect(report.kept).toHaveLength(1);
    expect(report.rejected).toHaveLength(1);
    expect(report.counts.denylist_title).toBe(1);
    expect(report.kept[0].title).toBe("Backend Engineer | Lever");
  });

  it("drops locale-prefixed about-us pages", () => {
    const input: ExaResult[] = [
      r("https://www.smartrecruiters.com/de/about-us/leadership/michal-nowak"),
      r("https://www.smartrecruiters.com/about-us/leadership/michal-nowak"),
      r("https://jobs.smartrecruiters.com/oneclick-ui/company/Foo/publication/123"),
    ];
    const report = filterResults(input);
    expect(report.kept).toHaveLength(1);
    expect(report.rejected).toHaveLength(2);
  });
});
