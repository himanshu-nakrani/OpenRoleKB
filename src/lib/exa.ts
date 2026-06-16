import Exa from "exa-js";
import type { Filters, ExaResult } from "@/types/job";
import { EXA_NUM_RESULTS } from "@/lib/config";
import { filterResults, type FilterReport } from "@/lib/retrieval-quality";
import { countryCodeForLocation } from "@/lib/city-synonyms";

// Exa includeDomains matches the listed domain AND all subdomains. Pin the
// jobs subdomain where one exists, otherwise leave the root so per-tenant
// subdomains (company.bamboohr.com, company.teamtailor.com, …) still match.
// Root-domain entries like "ashbyhq.com" also surface marketing pages on
// www.ashbyhq.com, which then burn the entire result budget — see the
// senior-react-remote eval case for the regression that motivated this.
const ATS_DOMAINS = [
  "boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "myworkdayjobs.com",
  "jobs.smartrecruiters.com",
  "bamboohr.com",
  "recruitee.com",
  "jobs.personio.de",
  "teamtailor.com",
];

let exaClient: Exa | null = null;

function getExa(): Exa {
  if (!exaClient) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error("EXA_API_KEY environment variable is not set");
    }
    exaClient = new Exa(apiKey);
  }
  return exaClient;
}

function getUserLocation(filters: Filters): string | undefined {
  if (filters.remote === true && !filters.location) return undefined;
  // Region-hint locations ("EU timezone", "EMEA") aren't real places — don't
  // fall back to "US" for them when the user is remote; that mis-biases recall.
  if (filters.location && isRegionHint(filters.location)) {
    return filters.remote === true ? undefined : "US";
  }
  return countryCodeForLocation(filters.location) ?? "US";
}

// Phrases like "EU timezone", "EMEA", "US east coast" parse into filters.location
// but aren't places Exa neural search can satisfy with `in <X>`. Including them
// collapses recall to zero. Treat them as remote-region hints instead: drop from
// the `in ...` clause and let `remote-friendly` + rerank carry the regional bias.
const REGION_HINT_RX = /timezone|emea|apac|latam|americas|\b(?:eu|us|uk|na)\s+(?:east|west|central)\b/i;

function isRegionHint(location: string): boolean {
  return REGION_HINT_RX.test(location);
}

function buildQueryString(filters: Filters): string {
  const parts: string[] = [];

  // Better ordering and phrasing for Exa neural search (role + seniority first is usually strongest signal)
  if (filters.seniority) parts.push(filters.seniority);
  if (filters.role) parts.push(filters.role);
  if (filters.skills?.length) parts.push(filters.skills.join(", "));
  if (filters.location && !isRegionHint(filters.location)) parts.push(`in ${filters.location}`);
  if (filters.remote) parts.push("remote-friendly");
  parts.push("job posting hiring");

  let q = parts.join(" ");

  if (filters.exclude?.length) {
    // Use exclusion syntax that neural search understands reasonably well
    q += " -" + filters.exclude.map((e) => `(${e})`).join(" -");
  }

  return q;
}

export const __test__ = { buildQueryString, getUserLocation, isRegionHint };

export async function searchJobsWithReport(
  query: string,
  filters: Filters,
  signal?: AbortSignal,
): Promise<{ results: ExaResult[]; quality: FilterReport["counts"] }> {
  const exa = getExa();
  const queryStr = buildQueryString(filters);

  const params: Record<string, unknown> = {
    numResults: EXA_NUM_RESULTS,
    type: "neural",
    contents: {
      text: { maxCharacters: 2000 },
      highlights: { numSentences: 3 },
    },
    includeDomains: ATS_DOMAINS,
  };

  const userLocation = getUserLocation(filters);
  if (userLocation) params.userLocation = userLocation;

  if (filters.freshnessDays && filters.freshnessDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - filters.freshnessDays);
    params.startPublishedDate = since.toISOString();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await exa.searchAndContents(queryStr, { ...params, signal } as any);

  if (!response.results?.length) {
    return { results: [], quality: { kept: 0, denylist_path: 0, denylist_title: 0, ats_url_not_individual_job: 0, no_signals: 0 } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: ExaResult[] = response.results.map((r: any) => ({
    id: r.id,
    title: r.title || "Untitled",
    url: r.url,
    text: r.text || "",
    highlights: r.highlights || [],
    publishedDate: r.publishedDate,
    author: r.author,
    company: r.author,
  }));

  // Drop denylisted URLs (Ashby /blog/, /resources/, Workable /post-jobs-for-free/, etc.)
  // before they consume rerank budget. Keep ATS listings and unknown hosts —
  // the LLM reranker handles ambiguous cases better than a hard rule would.
  const report = filterResults(raw);
  return { results: report.kept, quality: report.counts };
}

export async function searchJobs(
  query: string,
  filters: Filters,
  signal?: AbortSignal,
): Promise<ExaResult[]> {
  const { results } = await searchJobsWithReport(query, filters, signal);
  return results;
}
