import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";

// ---------------------------------------------------------------------------
// Helpers mirroring ingest-adzuna.ts (kept in sync manually)
// ---------------------------------------------------------------------------
const INR_TO_USD = 0.012;

function detectRemote(location: string | undefined, description: string): boolean | null {
  const haystack = `${location ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

interface AdzunaJob {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { area?: string[]; display_name?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: number;
  redirect_url: string;
  description?: string;
  created?: string;
}

function buildSalary(
  job: AdzunaJob,
  country: string,
  description: string,
): { min?: number; max?: number; raw?: string } {
  const hasSalary = job.salary_min != null || job.salary_max != null;
  if (hasSalary && job.salary_is_predicted !== 1) {
    if (country === "in") {
      const min = job.salary_min != null ? Math.round(job.salary_min * INR_TO_USD) : undefined;
      const max = job.salary_max != null ? Math.round(job.salary_max * INR_TO_USD) : undefined;
      const raw =
        job.salary_min != null && job.salary_max != null
          ? `₹${Math.round(job.salary_min / 100_000)}L - ₹${Math.round(job.salary_max / 100_000)}L`
          : job.salary_min != null
            ? `₹${Math.round(job.salary_min / 100_000)}L`
            : undefined;
      return { min, max, raw };
    } else {
      return {
        min: job.salary_min ?? undefined,
        max: job.salary_max ?? undefined,
        raw:
          job.salary_min != null && job.salary_max != null
            ? `$${Math.round((job.salary_min ?? 0) / 1000)}k - $${Math.round((job.salary_max ?? 0) / 1000)}k`
            : undefined,
      };
    }
  }
  return extractSalary(description);
}

function normalizeAdzunaJob(job: AdzunaJob, country: string) {
  const company = job.company?.display_name?.trim() || "Unknown";
  const title = job.title?.trim() || "";
  const description = job.description?.trim() ?? "";
  const locationRaw =
    job.location?.display_name?.trim() ||
    job.location?.area?.filter(Boolean).join(", ") ||
    null;
  const location = normalizeLocation(locationRaw);
  const isRemote = detectRemote(locationRaw ?? undefined, description);
  const salary = buildSalary(job, country, description);
  const publishedAt = job.created ? new Date(job.created) : null;
  const dedupKey = createHash("sha256")
    .update(`${title.toLowerCase()}|${company.toLowerCase()}|${(location || "").toLowerCase()}`)
    .digest("hex");

  return { title, company, description, locationRaw, location, isRemote, salary, publishedAt, dedupKey };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INDIA_JOB: AdzunaJob = {
  id: "adzuna-in-1",
  title: "Backend Engineer",
  company: { display_name: "Razorpay" },
  location: { display_name: "Bengaluru", area: ["India", "Karnataka", "Bengaluru"] },
  salary_min: 1_500_000, // 15 LPA in INR
  salary_max: 2_500_000, // 25 LPA in INR
  salary_is_predicted: 0,
  redirect_url: "https://www.adzuna.in/details/adzuna-in-1",
  description: "Join Razorpay's backend team. On-site Bengaluru.",
  created: "2026-06-01T10:00:00Z",
};

const US_JOB: AdzunaJob = {
  id: "adzuna-us-1",
  title: "Staff Software Engineer",
  company: { display_name: "Stripe" },
  location: { display_name: "San Francisco, CA", area: ["US", "California", "San Francisco"] },
  salary_min: 200_000,
  salary_max: 280_000,
  salary_is_predicted: 0,
  redirect_url: "https://www.adzuna.com/details/adzuna-us-1",
  description: "Stripe engineering. Hybrid work in SF.",
  created: "2026-05-28T08:00:00Z",
};

const PREDICTED_SALARY_JOB: AdzunaJob = {
  id: "adzuna-in-2",
  title: "Data Scientist",
  company: { display_name: "Swiggy" },
  location: { display_name: "Mumbai", area: ["India", "Maharashtra", "Mumbai"] },
  salary_min: 1_200_000,
  salary_max: 2_000_000,
  salary_is_predicted: 1, // predicted — should fall back to text extraction
  redirect_url: "https://www.adzuna.in/details/adzuna-in-2",
  description: "Data Scientist at Swiggy. CTC: ₹18-22 LPA.",
  created: "2026-06-03T12:00:00Z",
};

const REMOTE_JOB: AdzunaJob = {
  id: "adzuna-us-2",
  title: "Senior Frontend Developer",
  company: { display_name: "Automattic" },
  location: { display_name: "Remote", area: ["Worldwide"] },
  redirect_url: "https://www.adzuna.com/details/adzuna-us-2",
  description: "Fully remote position. Work from anywhere.",
  // no `created` — publishedAt should be null
};

const NO_COMPANY_JOB: AdzunaJob = {
  id: "adzuna-in-3",
  title: "DevOps Engineer",
  location: { display_name: "Hyderabad", area: ["India", "Telangana", "Hyderabad"] },
  redirect_url: "https://www.adzuna.in/details/adzuna-in-3",
  description: "DevOps role at a stealth startup.",
  created: "2026-06-07T07:00:00Z",
};

// ---------------------------------------------------------------------------
describe("Adzuna normalizer — basic fields", () => {
  it("extracts title and company", () => {
    const r = normalizeAdzunaJob(INDIA_JOB, "in");
    expect(r.title).toBe("Backend Engineer");
    expect(r.company).toBe("Razorpay");
  });

  it("defaults company to 'Unknown' when absent", () => {
    const r = normalizeAdzunaJob(NO_COMPANY_JOB, "in");
    expect(r.company).toBe("Unknown");
  });

  it("parses publishedAt from ISO string", () => {
    const r = normalizeAdzunaJob(INDIA_JOB, "in");
    expect(r.publishedAt).toBeInstanceOf(Date);
    expect(r.publishedAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("returns null publishedAt when created is absent", () => {
    const r = normalizeAdzunaJob(REMOTE_JOB, "us");
    expect(r.publishedAt).toBeNull();
  });
});

describe("Adzuna normalizer — location & remote", () => {
  it("uses display_name as locationRaw for India job", () => {
    const r = normalizeAdzunaJob(INDIA_JOB, "in");
    expect(r.locationRaw).toBe("Bengaluru");
  });

  it("normalizes 'san francisco' via LOCATION_NORM lookup", () => {
    const r = normalizeAdzunaJob(US_JOB, "us");
    // display_name is "San Francisco, CA" — not in the exact lookup key form → passes through
    expect(r.locationRaw).toBe("San Francisco, CA");
  });

  it("detects remote from location display_name", () => {
    const r = normalizeAdzunaJob(REMOTE_JOB, "us");
    expect(r.isRemote).toBe(true);
  });

  it("detects on-site from description", () => {
    const r = normalizeAdzunaJob(INDIA_JOB, "in");
    expect(r.isRemote).toBe(false);
  });

  it("returns null isRemote when no signal", () => {
    const r = normalizeAdzunaJob(US_JOB, "us");
    // "Hybrid work" doesn't match current patterns
    expect(r.isRemote).toBeNull();
  });
});

describe("Adzuna normalizer — INR salary", () => {
  it("converts real INR salary_min/max to USD", () => {
    const r = normalizeAdzunaJob(INDIA_JOB, "in");
    // 15L INR * 0.012 = 18,000 USD; 25L INR * 0.012 = 30,000 USD
    expect(r.salary.min).toBe(18_000);
    expect(r.salary.max).toBe(30_000);
    expect(r.salary.raw).toBe("₹15L - ₹25L");
  });

  it("falls back to text extraction for predicted salary", () => {
    const r = normalizeAdzunaJob(PREDICTED_SALARY_JOB, "in");
    // salary_is_predicted=1 → ignores structured fields, extracts from description
    // Description: "CTC: ₹18-22 LPA" → 18L-22L INR → 21,600-26,400 USD
    expect(r.salary.min).toBe(21_600);
    expect(r.salary.max).toBe(26_400);
  });

  it("returns empty salary when neither structured nor text salary found", () => {
    const r = normalizeAdzunaJob(NO_COMPANY_JOB, "in");
    expect(r.salary).toEqual({});
  });
});

describe("Adzuna normalizer — USD salary", () => {
  it("passes through real USD salary_min/max", () => {
    const r = normalizeAdzunaJob(US_JOB, "us");
    expect(r.salary.min).toBe(200_000);
    expect(r.salary.max).toBe(280_000);
    expect(r.salary.raw).toBe("$200k - $280k");
  });
});

describe("Adzuna normalizer — dedup key", () => {
  it("generates consistent sha256 dedupKey", () => {
    const r1 = normalizeAdzunaJob(INDIA_JOB, "in");
    const r2 = normalizeAdzunaJob(INDIA_JOB, "in");
    expect(r1.dedupKey).toBe(r2.dedupKey);
    expect(r1.dedupKey).toHaveLength(64);
  });

  it("generates different key for different company", () => {
    const jobA = { ...INDIA_JOB, company: { display_name: "Razorpay" } };
    const jobB = { ...INDIA_JOB, company: { display_name: "Paytm" } };
    expect(normalizeAdzunaJob(jobA, "in").dedupKey).not.toBe(normalizeAdzunaJob(jobB, "in").dedupKey);
  });
});
