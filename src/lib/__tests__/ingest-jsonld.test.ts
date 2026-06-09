import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";
import { hasJobPostingSchema } from "@/lib/retrieval-quality";

// ---------------------------------------------------------------------------
// Types and helpers mirroring ingest-jsonld.ts (kept in sync manually)
// The script lives outside src/ so cannot be imported via the @/ alias.
// ---------------------------------------------------------------------------

/** Parsed schema.org/JobPosting data (subset we use). */
export interface JsonLdJobPosting {
  "@type": string;
  title?: string;
  hiringOrganization?: { name?: string; sameAs?: string };
  jobLocation?:
    | { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } | string }
    | Array<{ address?: Record<string, string> | string }>;
  description?: string;
  datePosted?: string;
  url?: string;
  identifier?: { name?: string; value?: string } | string;
  employmentType?: string;
  baseSalary?: {
    value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string };
    currency?: string;
  };
  jobLocationType?: string;
}

// ---------------------------------------------------------------------------
// Re-export helpers that mirror ingest-jsonld.ts (for unit testing without DB)
// ---------------------------------------------------------------------------

const LD_JSON_RX = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Extract all JobPosting JSON-LD blocks from HTML (mirrors ingest-jsonld.ts). */
function extractJobPostings(html: string): JsonLdJobPosting[] {
  if (!hasJobPostingSchema(html)) return [];
  const results: JsonLdJobPosting[] = [];
  let match: RegExpExecArray | null;
  const rx = new RegExp(LD_JSON_RX.source, "gi");
  while ((match = rx.exec(html)) !== null) {
    const raw = match[1].trim();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      if (typeof c === "object" && c !== null) {
        const obj = c as Record<string, unknown>;
        if (obj["@type"] === "JobPosting") results.push(obj as unknown as JsonLdJobPosting);
      }
    }
  }
  return results;
}

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

function extractTitle(jp: JsonLdJobPosting): string {
  return (jp.title ?? "").trim();
}

function extractCompany(jp: JsonLdJobPosting, fallback: string): string {
  return jp.hiringOrganization?.name?.trim() || fallback;
}

function extractLocationRaw(jp: JsonLdJobPosting): string | null {
  const loc = jp.jobLocation;
  if (!loc) return null;
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first) return null;
  const addr = first.address;
  if (!addr) return null;
  if (typeof addr === "string") return addr.trim() || null;
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
    .filter(Boolean)
    .join(", ");
  return parts || null;
}

function detectRemote(jp: JsonLdJobPosting, description: string, locationRaw: string | null): boolean | null {
  if (jp.jobLocationType === "TELECOMMUTE") return true;
  const haystack = `${locationRaw ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

function extractDescription(jp: JsonLdJobPosting): string {
  return stripHtml(jp.description ?? "");
}

function extractSalaryFromJsonLd(jp: JsonLdJobPosting, description: string) {
  const bs = jp.baseSalary;
  if (bs?.value && bs.currency === "USD") {
    const v = bs.value;
    return {
      min: v.minValue ?? v.value ?? undefined,
      max: v.maxValue ?? undefined,
      raw: v.minValue != null && v.maxValue != null ? `$${v.minValue} - $${v.maxValue}` : undefined,
    };
  }
  return extractSalary(description);
}

function extractUrl(jp: JsonLdJobPosting, pageUrl: string): string {
  return (jp.url ?? "").trim() || pageUrl;
}

function extractPublishedAt(jp: JsonLdJobPosting): Date | null {
  if (!jp.datePosted) return null;
  const d = new Date(jp.datePosted);
  return isNaN(d.getTime()) ? null : d;
}

function normalizePosting(jp: JsonLdJobPosting, pageUrl: string, fallbackCompany: string) {
  const title = extractTitle(jp);
  const company = extractCompany(jp, fallbackCompany);
  const description = extractDescription(jp);
  const locationRaw = extractLocationRaw(jp);
  const location = normalizeLocation(locationRaw);
  const isRemote = detectRemote(jp, description, locationRaw);
  const salary = extractSalaryFromJsonLd(jp, description);
  const url = extractUrl(jp, pageUrl);
  const publishedAt = extractPublishedAt(jp);
  const dedupKey = createHash("sha256")
    .update(`${title.toLowerCase()}|${company.toLowerCase()}|${(location || "").toLowerCase()}`)
    .digest("hex");
  return { title, company, description, locationRaw, location, isRemote, salary, url, publishedAt, dedupKey };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_HTML_WITH_JOB = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    "title": "Senior Software Engineer",
    "hiringOrganization": { "name": "Acme Corp", "sameAs": "https://acme.com" },
    "jobLocation": {
      "address": {
        "addressLocality": "San Francisco",
        "addressRegion": "CA",
        "addressCountry": "US"
      }
    },
    "description": "<p>Build great software at Acme. Salary: $120k - $160k/yr.</p>",
    "datePosted": "2026-06-01",
    "url": "https://acme.com/jobs/123",
    "identifier": { "name": "Acme Corp", "value": "ABC123" }
  }
  </script>
</head>
<body><h1>Senior Software Engineer</h1></body>
</html>
`;

const SAMPLE_HTML_MULTI_JOB = `
<script type="application/ld+json">
[
  {
    "@type": "Organization",
    "name": "NVIDIA"
  },
  {
    "@type": "JobPosting",
    "title": "ML Engineer",
    "hiringOrganization": { "name": "NVIDIA" },
    "jobLocation": { "address": { "addressLocality": "Austin", "addressRegion": "TX" } },
    "description": "Join NVIDIA AI team. In-office role.",
    "datePosted": "2026-05-20"
  },
  {
    "@type": "JobPosting",
    "title": "Software Infrastructure Engineer",
    "hiringOrganization": { "name": "NVIDIA" },
    "jobLocationType": "TELECOMMUTE",
    "description": "Remote-first position at NVIDIA.",
    "datePosted": "2026-05-25"
  }
]
</script>
`;

const SAMPLE_HTML_NO_JOB = `
<html>
<head>
  <script type="application/ld+json">{ "@type": "WebSite", "name": "Acme" }</script>
</head>
<body><p>No jobs here</p></body>
</html>
`;

const SAMPLE_HTML_SALARY_STRUCTURED = `
<script type="application/ld+json">
{
  "@type": "JobPosting",
  "title": "Principal Engineer",
  "hiringOrganization": { "name": "TechCo" },
  "baseSalary": {
    "currency": "USD",
    "value": { "minValue": 180000, "maxValue": 250000, "unitText": "YEAR" }
  },
  "description": "Senior technical leadership role."
}
</script>
`;

const POSTING_REMOTE: JsonLdJobPosting = {
  "@type": "JobPosting",
  title: "DevRel Engineer",
  hiringOrganization: { name: "OpenSource Co" },
  jobLocationType: "TELECOMMUTE",
  description: "Full remote advocacy role.",
};

const POSTING_ONSITE: JsonLdJobPosting = {
  "@type": "JobPosting",
  title: "Product Manager",
  hiringOrganization: { name: "Offline Inc" },
  jobLocation: {
    address: { addressLocality: "Chicago", addressRegion: "IL", addressCountry: "US" },
  },
  description: "In-office position in Chicago HQ.",
};

const POSTING_NO_URL: JsonLdJobPosting = {
  "@type": "JobPosting",
  title: "QA Engineer",
  hiringOrganization: { name: "TestCo" },
  description: "QA role",
};

// ---------------------------------------------------------------------------
describe("extractJobPostings — HTML parsing", () => {
  it("extracts one JobPosting from a page with a single block", () => {
    const jobs = extractJobPostings(SAMPLE_HTML_WITH_JOB);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Senior Software Engineer");
  });

  it("extracts multiple JobPostings from a JSON array block", () => {
    const jobs = extractJobPostings(SAMPLE_HTML_MULTI_JOB);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.title)).toContain("ML Engineer");
    expect(jobs.map((j) => j.title)).toContain("Software Infrastructure Engineer");
  });

  it("returns empty array for page with no JobPosting JSON-LD", () => {
    const jobs = extractJobPostings(SAMPLE_HTML_NO_JOB);
    expect(jobs).toHaveLength(0);
  });

  it("returns empty array for plain HTML with no JSON-LD at all", () => {
    const jobs = extractJobPostings("<html><body><p>No structured data</p></body></html>");
    expect(jobs).toHaveLength(0);
  });

  it("extracts structured salary from baseSalary block", () => {
    const jobs = extractJobPostings(SAMPLE_HTML_SALARY_STRUCTURED);
    expect(jobs).toHaveLength(1);
    const r = normalizePosting(jobs[0], "https://techco.com/jobs/1", "TechCo");
    expect(r.salary.min).toBe(180_000);
    expect(r.salary.max).toBe(250_000);
    expect(r.salary.raw).toBe("$180000 - $250000");
  });
});

describe("extractJobPostings — reuses hasJobPostingSchema guard", () => {
  it("returns [] fast when hasJobPostingSchema returns false", () => {
    const html = "<html><body>No schema here</body></html>";
    expect(hasJobPostingSchema(html)).toBe(false);
    expect(extractJobPostings(html)).toHaveLength(0);
  });
});

describe("JSON-LD normalizer — title & company", () => {
  it("extracts title and company from fixture", () => {
    const jp = extractJobPostings(SAMPLE_HTML_WITH_JOB)[0];
    const r = normalizePosting(jp, "https://acme.com/jobs/123", "fallback");
    expect(r.title).toBe("Senior Software Engineer");
    expect(r.company).toBe("Acme Corp");
  });

  it("falls back to provided company when hiringOrganization absent", () => {
    const jp: JsonLdJobPosting = { "@type": "JobPosting", title: "Engineer" };
    const r = normalizePosting(jp, "https://example.com/job/1", "ExampleCo");
    expect(r.company).toBe("ExampleCo");
  });
});

describe("JSON-LD normalizer — location", () => {
  it("assembles locationRaw from address parts", () => {
    const jp = extractJobPostings(SAMPLE_HTML_WITH_JOB)[0];
    const r = normalizePosting(jp, "https://acme.com/jobs/123", "Acme");
    expect(r.locationRaw).toBe("San Francisco, CA, US");
  });

  it("normalizes 'san francisco' via LOCATION_NORM", () => {
    const jp: JsonLdJobPosting = {
      "@type": "JobPosting",
      title: "Engineer",
      jobLocation: { address: { addressLocality: "san francisco" } },
    };
    const r = normalizePosting(jp, "https://test.com", "Test");
    expect(r.location).toBe("San Francisco, CA");
  });

  it("returns null locationRaw when jobLocation absent", () => {
    const jp: JsonLdJobPosting = { "@type": "JobPosting", title: "Engineer" };
    const r = normalizePosting(jp, "https://test.com", "Test");
    expect(r.locationRaw).toBeNull();
  });
});

describe("JSON-LD normalizer — remote detection", () => {
  it("detects TELECOMMUTE jobLocationType as remote", () => {
    const r = normalizePosting(POSTING_REMOTE, "https://os.co/job/1", "OpenSource Co");
    expect(r.isRemote).toBe(true);
  });

  it("detects 'In-office' phrase as on-site", () => {
    const r = normalizePosting(POSTING_ONSITE, "https://offline.com/job/1", "Offline Inc");
    expect(r.isRemote).toBe(false);
  });

  it("detects remote from multi-job fixture", () => {
    const jobs = extractJobPostings(SAMPLE_HTML_MULTI_JOB);
    const infraJob = jobs.find((j) => j.title === "Software Infrastructure Engineer");
    expect(infraJob).toBeDefined();
    const r = normalizePosting(infraJob!, "https://nvidia.com/job/2", "NVIDIA");
    expect(r.isRemote).toBe(true);
  });
});

describe("JSON-LD normalizer — description", () => {
  it("strips HTML from description", () => {
    const jp = extractJobPostings(SAMPLE_HTML_WITH_JOB)[0];
    const r = normalizePosting(jp, "https://acme.com/jobs/123", "Acme");
    expect(r.description).not.toContain("<p>");
    expect(r.description).toContain("Build great software");
  });

  it("returns empty string when description absent", () => {
    const jp: JsonLdJobPosting = { "@type": "JobPosting", title: "Test" };
    const r = normalizePosting(jp, "https://test.com", "Test");
    expect(r.description).toBe("");
  });
});

describe("JSON-LD normalizer — salary", () => {
  it("extracts USD salary from description text", () => {
    const jp = extractJobPostings(SAMPLE_HTML_WITH_JOB)[0];
    const r = normalizePosting(jp, "https://acme.com/jobs/123", "Acme");
    expect(r.salary.min).toBe(120_000);
    expect(r.salary.max).toBe(160_000);
  });

  it("returns empty salary when no salary info anywhere", () => {
    const jp: JsonLdJobPosting = {
      "@type": "JobPosting",
      title: "Engineer",
      description: "Join our team.",
    };
    const r = normalizePosting(jp, "https://test.com", "Test");
    expect(r.salary).toEqual({});
  });
});

describe("JSON-LD normalizer — URL and publishedAt", () => {
  it("uses jp.url when present", () => {
    const jp = extractJobPostings(SAMPLE_HTML_WITH_JOB)[0];
    const r = normalizePosting(jp, "https://fallback.com", "Acme");
    expect(r.url).toBe("https://acme.com/jobs/123");
  });

  it("falls back to pageUrl when jp.url absent", () => {
    const r = normalizePosting(POSTING_NO_URL, "https://fallback.com/job/1", "TestCo");
    expect(r.url).toBe("https://fallback.com/job/1");
  });

  it("parses datePosted as publishedAt", () => {
    const jp = extractJobPostings(SAMPLE_HTML_WITH_JOB)[0];
    const r = normalizePosting(jp, "https://acme.com/jobs/123", "Acme");
    expect(r.publishedAt).toBeInstanceOf(Date);
    expect(r.publishedAt?.toISOString().startsWith("2026-06-01")).toBe(true);
  });

  it("returns null publishedAt when datePosted absent", () => {
    const r = normalizePosting(POSTING_NO_URL, "https://test.com", "TestCo");
    expect(r.publishedAt).toBeNull();
  });
});

describe("JSON-LD normalizer — dedupKey", () => {
  it("generates consistent sha256 for same input", () => {
    const jp = extractJobPostings(SAMPLE_HTML_WITH_JOB)[0];
    const r1 = normalizePosting(jp, "https://acme.com/jobs/123", "Acme Corp");
    const r2 = normalizePosting(jp, "https://acme.com/jobs/123", "Acme Corp");
    expect(r1.dedupKey).toBe(r2.dedupKey);
    expect(r1.dedupKey).toHaveLength(64);
  });

  it("generates different keys for different titles", () => {
    const jp1: JsonLdJobPosting = { "@type": "JobPosting", title: "Engineer" };
    const jp2: JsonLdJobPosting = { "@type": "JobPosting", title: "Designer" };
    expect(normalizePosting(jp1, "https://t.com", "Co").dedupKey).not.toBe(
      normalizePosting(jp2, "https://t.com", "Co").dedupKey,
    );
  });
});
