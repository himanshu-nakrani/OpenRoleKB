import { CITY_SYNONYMS, COUNTRY_ALIASES, normalizeText } from "@/lib/city-synonyms";
import type { Ats } from "@/lib/ats-discovery";

export interface VerificationResult {
  ok: boolean;
  jobCount: number;
  sampleTitles: string[];
  hasIndianJobs: boolean;
  companyName?: string;
  status: "verified" | "dead" | "rate_limited" | "candidate";
  error?: string;
}

export interface VerifyOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const USER_AGENT = "OpenRoleKB-ats-discovery/0.1 (+https://github.com/himanshu-nakrani/OpenRoleKB)";
const lastRequestByHost = new Map<string, number>();

const INDIA_CITY_WORDS = CITY_SYNONYMS
  .filter((entry) => entry.countryCode === "IN")
  .flatMap((entry) => entry.synonyms.map((synonym) => normalizeText(synonym)));

function hasIndiaGeo(text: string | undefined | null): boolean {
  if (!text) return false;
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/(^| )india( |$)/.test(normalized)) return true;
  if (COUNTRY_ALIASES[normalized] === "IN") return true;
  return INDIA_CITY_WORDS.some((city) => city && new RegExp(`(^| )${city.replace(/ /g, " +")}( |$)`).test(normalized));
}

function endpointFor(ats: Ats, slug: string): URL {
  switch (ats) {
    case "greenhouse":
      return new URL(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=false`);
    case "lever":
      return new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
    case "ashby":
      return new URL(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
    case "smartrecruiters":
      return new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=50`);
  }
}

async function politeFetch(url: URL, fetchImpl: typeof fetch, now: () => number): Promise<Response> {
  const last = lastRequestByHost.get(url.host) ?? 0;
  const wait = Math.max(0, 1000 - (now() - last));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestByHost.set(url.host, now());
  return fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
}

type NormalizedJob = { title: string; location?: string | null };

function normalizeJobs(ats: Ats, data: unknown): { jobs: NormalizedJob[]; companyName?: string } {
  switch (ats) {
    case "greenhouse": {
      const body = data as { jobs?: Array<{ title?: string; location?: { name?: string }; company_name?: string }> };
      return {
        jobs: (body.jobs ?? []).map((j) => ({ title: j.title ?? "Untitled", location: j.location?.name })),
        companyName: body.jobs?.find((j) => j.company_name)?.company_name,
      };
    }
    case "lever": {
      const rows = Array.isArray(data) ? data as Array<{ text?: string; categories?: { location?: string } }> : [];
      return { jobs: rows.map((j) => ({ title: j.text ?? "Untitled", location: j.categories?.location })) };
    }
    case "ashby": {
      const body = data as { jobs?: Array<{ title?: string; location?: string }>; jobBoard?: { name?: string } };
      return {
        jobs: (body.jobs ?? []).map((j) => ({ title: j.title ?? "Untitled", location: j.location })),
        companyName: body.jobBoard?.name,
      };
    }
    case "smartrecruiters": {
      const body = data as { content?: Array<{ name?: string; location?: { fullLocation?: string; city?: string; country?: string } }> };
      return {
        jobs: (body.content ?? []).map((j) => ({
          title: j.name ?? "Untitled",
          location: j.location?.fullLocation ?? [j.location?.city, j.location?.country].filter(Boolean).join(", "),
        })),
      };
    }
  }
}

export async function verifyTenant(ats: Ats, slug: string, options: VerifyOptions = {}): Promise<VerificationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const url = endpointFor(ats, slug);

  try {
    const res = await politeFetch(url, fetchImpl, now);
    if (res.status === 404) {
      return { ok: false, jobCount: 0, sampleTitles: [], hasIndianJobs: false, status: "dead", error: "HTTP 404" };
    }
    if (res.status === 429) {
      return { ok: false, jobCount: 0, sampleTitles: [], hasIndianJobs: false, status: "rate_limited", error: "HTTP 429" };
    }
    if (!res.ok) {
      return { ok: false, jobCount: 0, sampleTitles: [], hasIndianJobs: false, status: "candidate", error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const normalized = normalizeJobs(ats, data);
    const first50 = normalized.jobs.slice(0, 50);
    return {
      ok: true,
      jobCount: normalized.jobs.length,
      sampleTitles: normalized.jobs.slice(0, 5).map((j) => j.title),
      hasIndianJobs: first50.some((j) => hasIndiaGeo(j.location)),
      companyName: normalized.companyName,
      status: "verified",
    };
  } catch (err) {
    return {
      ok: false,
      jobCount: 0,
      sampleTitles: [],
      hasIndianJobs: false,
      status: "candidate",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const __test__ = { hasIndiaGeo, normalizeJobs };
