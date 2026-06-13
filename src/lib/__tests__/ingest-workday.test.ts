import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";

// ---------------------------------------------------------------------------
// Helpers mirroring ingest-workday.ts (kept in sync manually)
// ---------------------------------------------------------------------------
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function detectRemote(location: string | undefined, description: string): boolean | null {
  const haystack = `${location ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

// Simulate the normalizeWorkdayPosting logic used in ingest-workday.ts
interface WdJobDetail {
  title?: string;
  jobDescription?: string;
  location?: string;
  jobReqId?: string;
  externalUrl?: string;
}

function normalizeWorkdayPosting(
  posting: { title: string; externalPath: string; locationsText?: string },
  detail: WdJobDetail | null,
  company: string,
  tenantBase: string,
  board: string,
) {
  const title = (detail?.title ?? posting.title).trim();
  const descHtml = detail?.jobDescription ?? "";
  const description = descHtml ? stripHtml(descHtml) : "";
  const locationRaw = (detail?.location ?? posting.locationsText ?? "").trim() || null;
  const location = normalizeLocation(locationRaw);
  const isRemote = detectRemote(locationRaw ?? undefined, description);
  const salary = description ? extractSalary(description) : {};
  const externalUrl =
    detail?.externalUrl?.trim() ||
    `${tenantBase}/en-US/${board}${posting.externalPath}`;
  const dedupKey = createHash("sha256")
    .update(`${title.toLowerCase()}|${company.toLowerCase()}|${(location || "").toLowerCase()}`)
    .digest("hex");

  return { title, description, locationRaw, location, isRemote, salary, externalUrl, dedupKey };
}

// ---------------------------------------------------------------------------
// Fixtures — representative Workday API responses
// ---------------------------------------------------------------------------
const NVIDIA_POSTING = {
  title: "Senior HPC Storage Engineer",
  externalPath: "/job/US-CA-Santa-Clara/Senior-HPC-Storage-Engineer_JR2014997",
  locationsText: "2 Locations",
  postedOn: "Posted Today",
  bulletFields: ["JR2014997"],
};

const NVIDIA_DETAIL: WdJobDetail = {
  title: "Senior HPC Storage Engineer",
  jobDescription:
    "<p>NVIDIA is hiring. We offer <strong>competitive compensation</strong> including $120k - $200k annually.</p><ul><li>Design storage systems</li><li>Work from Santa Clara office</li></ul>",
  location: "US, CA, Santa Clara",
  jobReqId: "JR2014997",
  externalUrl: "",
};

const INTEL_POSTING = {
  title: "Machine Learning Engineer",
  externalPath: "/job/US-OR-Hillsboro/ML-Engineer_3234567",
  locationsText: "Remote US",
  postedOn: "Posted 2 Days Ago",
};

const INTEL_DETAIL: WdJobDetail = {
  title: "Machine Learning Engineer",
  jobDescription:
    "<p>Join Intel&#39;s AI research team. This is a <em>remote</em> role. Salary: $140k - $180k/yr.</p>",
  location: "Remote US",
  jobReqId: "3234567",
};

// ---------------------------------------------------------------------------
describe("Workday normalizer — title & URL", () => {
  it("uses detail title when available", () => {
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.title).toBe("Senior HPC Storage Engineer");
  });

  it("falls back to listing title when detail is null", () => {
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      null,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.title).toBe("Senior HPC Storage Engineer");
  });

  it("constructs canonical URL from tenantBase when externalUrl is empty", () => {
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.externalUrl).toContain("nvidia.wd5.myworkdayjobs.com");
    expect(r.externalUrl).toContain(NVIDIA_POSTING.externalPath);
  });

  it("uses externalUrl from detail when non-empty", () => {
    const detailWithUrl: WdJobDetail = { ...NVIDIA_DETAIL, externalUrl: "https://example.com/apply/JR2014997" };
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      detailWithUrl,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.externalUrl).toBe("https://example.com/apply/JR2014997");
  });
});

describe("Workday normalizer — location", () => {
  it("normalizes known city abbreviation from detail location", () => {
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    // "US, CA, Santa Clara" is an unknown alias → passes through unchanged
    expect(r.locationRaw).toBe("US, CA, Santa Clara");
    expect(r.location).toBe("US, CA, Santa Clara");
  });

  it("falls back to locationsText when detail location is absent", () => {
    // detail.location is undefined (field absent) → falls back to locationsText
    const noLocDetail: WdJobDetail = { title: NVIDIA_DETAIL.title, jobDescription: NVIDIA_DETAIL.jobDescription };
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      noLocDetail,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.locationRaw).toBe("2 Locations");
  });

  it("detects remote from location string", () => {
    const r = normalizeWorkdayPosting(
      INTEL_POSTING,
      INTEL_DETAIL,
      "Intel",
      "https://intel.wd1.myworkdayjobs.com",
      "External",
    );
    expect(r.isRemote).toBe(true);
  });

  it("returns null for remote when no explicit signal in description", () => {
    // NVIDIA_DETAIL description says "work from Santa Clara office" (no regex match)
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    // No explicit "remote" or "on-site"/"in-office" phrase → null
    expect(r.isRemote).toBeNull();
  });

  it("detects on-site from 'in-office' phrase in description", () => {
    const onSiteDetail: WdJobDetail = {
      ...NVIDIA_DETAIL,
      jobDescription: "<p>This role is in-office at our Santa Clara HQ.</p>",
    };
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      onSiteDetail,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.isRemote).toBe(false);
  });
});

describe("Workday normalizer — description & salary", () => {
  it("strips HTML tags from jobDescription", () => {
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.description).not.toContain("<p>");
    expect(r.description).not.toContain("<strong>");
    expect(r.description).toContain("NVIDIA is hiring");
  });

  it("decodes HTML entities", () => {
    const r = normalizeWorkdayPosting(
      INTEL_POSTING,
      INTEL_DETAIL,
      "Intel",
      "https://intel.wd1.myworkdayjobs.com",
      "External",
    );
    expect(r.description).toContain("Intel's"); // &#39; → '
  });

  it("extracts USD salary from description", () => {
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.salary.min).toBe(120_000);
    expect(r.salary.max).toBe(200_000);
    expect(r.salary.raw).toBe("$120k - $200k");
  });

  it("extracts USD salary with /yr context", () => {
    const r = normalizeWorkdayPosting(
      INTEL_POSTING,
      INTEL_DETAIL,
      "Intel",
      "https://intel.wd1.myworkdayjobs.com",
      "External",
    );
    expect(r.salary.min).toBe(140_000);
    expect(r.salary.max).toBe(180_000);
  });

  it("returns empty salary when no salary info", () => {
    const noSalaryDetail: WdJobDetail = { ...NVIDIA_DETAIL, jobDescription: "<p>Great job, apply now!</p>" };
    const r = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      noSalaryDetail,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r.salary).toEqual({});
  });
});

describe("Workday normalizer — dedup key", () => {
  it("produces consistent sha256 for same input", () => {
    const r1 = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    const r2 = normalizeWorkdayPosting(
      NVIDIA_POSTING,
      NVIDIA_DETAIL,
      "NVIDIA",
      "https://nvidia.wd5.myworkdayjobs.com",
      "NVIDIAExternalCareerSite",
    );
    expect(r1.dedupKey).toBe(r2.dedupKey);
    expect(r1.dedupKey).toHaveLength(64); // sha256 hex = 64 chars
  });

  it("produces different keys for different companies", () => {
    const r1 = normalizeWorkdayPosting(NVIDIA_POSTING, NVIDIA_DETAIL, "NVIDIA", "", "");
    const r2 = normalizeWorkdayPosting(NVIDIA_POSTING, NVIDIA_DETAIL, "Intel", "", "");
    expect(r1.dedupKey).not.toBe(r2.dedupKey);
  });
});
