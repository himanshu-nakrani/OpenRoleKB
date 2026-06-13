import Exa from "exa-js";
import { prisma } from "@/lib/prisma";

export const SUPPORTED_ATS = ["greenhouse", "lever", "ashby", "smartrecruiters"] as const;
export type Ats = (typeof SUPPORTED_ATS)[number];

export interface Candidate {
  ats: Ats;
  slug: string;
  source: string;
  hint?: string;
}

export interface DiscoveryOptions {
  ats?: Ats[];
  maxExaCalls?: number;
  fetchImpl?: typeof fetch;
  exaClient?: {
    searchAndContents: (query: string, params: Record<string, unknown>) => Promise<{ results?: Array<{ url?: string; title?: string; text?: string }> }>;
  };
}

const INDIA_SEEDS = ["Bengaluru", "Hyderabad", "Pune", "Mumbai", "Bangalore", "Gurugram"];

const ATS_HOSTS: Record<Ats, string> = {
  greenhouse: "boards.greenhouse.io",
  lever: "jobs.lever.co",
  ashby: "jobs.ashbyhq.com",
  smartrecruiters: "jobs.smartrecruiters.com",
};

const CUSTOMER_PAGES: Record<Ats, string[]> = {
  greenhouse: ["https://www.greenhouse.com/customers", "https://www.greenhouse.io/customers"],
  lever: ["https://www.lever.co/customers/", "https://www.lever.co/customer-stories/"],
  ashby: ["https://www.ashbyhq.com/customers", "https://www.ashbyhq.com/customer-stories"],
  smartrecruiters: ["https://www.smartrecruiters.com/customers/", "https://www.smartrecruiters.com/customer-stories/"],
};

function normalizeSlug(slug: string): string {
  return decodeURIComponent(slug)
    .trim()
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isSupportedAts(value: string): value is Ats {
  return (SUPPORTED_ATS as readonly string[]).includes(value);
}

function tryUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function extractCandidateFromUrl(rawUrl: string, source = "hint:url"): Candidate | null {
  const url = tryUrl(rawUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if ((host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") && parts.length >= 1) {
    return { ats: "greenhouse", slug: normalizeSlug(parts[0]), source, hint: rawUrl };
  }
  if (host === "boards-api.greenhouse.io" && parts[0] === "v1" && parts[1] === "boards" && parts[2]) {
    return { ats: "greenhouse", slug: normalizeSlug(parts[2]), source, hint: rawUrl };
  }

  if (host === "jobs.lever.co" && parts.length >= 1) {
    return { ats: "lever", slug: normalizeSlug(parts[0]), source, hint: rawUrl };
  }
  if (host === "api.lever.co" && parts[0] === "v0" && parts[1] === "postings" && parts[2]) {
    return { ats: "lever", slug: normalizeSlug(parts[2]), source, hint: rawUrl };
  }

  if (host === "jobs.ashbyhq.com" && parts.length >= 1) {
    return { ats: "ashby", slug: normalizeSlug(parts[0]), source, hint: rawUrl };
  }
  if (host === "api.ashbyhq.com" && parts[0] === "posting-api" && parts[1] === "job-board" && parts[2]) {
    return { ats: "ashby", slug: normalizeSlug(parts[2]), source, hint: rawUrl };
  }

  if (host === "jobs.smartrecruiters.com" && parts.length >= 1) {
    return { ats: "smartrecruiters", slug: normalizeSlug(parts[0]), source, hint: rawUrl };
  }
  if (host === "api.smartrecruiters.com" && parts[0] === "v1" && parts[1] === "companies" && parts[2]) {
    return { ats: "smartrecruiters", slug: normalizeSlug(parts[2]), source, hint: rawUrl };
  }

  return null;
}

export function extractCandidatesFromText(text: string, source: string): Candidate[] {
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s"'<>),]+/gi), (m) => m[0]);
  return dedupeCandidates(urls.map((url) => extractCandidateFromUrl(url, source)).filter((c): c is Candidate => Boolean(c)));
}

export function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (!c.slug || !isSupportedAts(c.ats)) continue;
    const key = `${c.ats}:${c.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function selectedAts(options?: DiscoveryOptions): Ats[] {
  return options?.ats?.length ? options.ats : [...SUPPORTED_ATS];
}

function getExaClient(options?: DiscoveryOptions) {
  if (options?.exaClient) return options.exaClient;
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("EXA_API_KEY environment variable is not set");
  return new Exa(apiKey);
}

export async function discoverFromExa(options: DiscoveryOptions = {}): Promise<{ candidates: Candidate[]; exaCalls: number }> {
  const exa = getExaClient(options);
  const cap = options.maxExaCalls ?? 20;
  let exaCalls = 0;
  const candidates: Candidate[] = [];

  for (const ats of selectedAts(options)) {
    for (const seed of INDIA_SEEDS.slice(0, 5)) {
      if (exaCalls >= cap) return { candidates: dedupeCandidates(candidates), exaCalls };
      const host = ATS_HOSTS[ats];
      const query = `${seed} software engineer jobs ${host}`;
      const response = await exa.searchAndContents(query, {
        numResults: 10,
        type: "neural",
        includeDomains: [host],
        contents: { text: { maxCharacters: 500 }, highlights: { numSentences: 1 } },
      });
      exaCalls++;
      for (const raw of response.results ?? []) {
        const r = raw as { url?: string; title?: string | null; text?: string };
        if (r.url) {
          const c = extractCandidateFromUrl(r.url, "exa");
          if (c?.ats === ats) candidates.push({ ...c, hint: r.title ?? r.url });
        }
        if (r.text) candidates.push(...extractCandidatesFromText(r.text, "exa"));
      }
    }
  }

  return { candidates: dedupeCandidates(candidates), exaCalls };
}

async function robotsAllows(url: URL, fetchImpl: typeof fetch): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", url.origin);
  try {
    const res = await fetchImpl(robotsUrl, { headers: { "User-Agent": "OpenRoleKB-ats-discovery/0.1" } });
    if (!res.ok) return true;
    const body = (await res.text()).toLowerCase();
    const path = url.pathname.toLowerCase();
    let applies = false;
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.split("#", 1)[0].trim();
      const ua = trimmed.match(/^user-agent:\s*(.+)$/i)?.[1]?.trim();
      if (ua) applies = ua === "*" || ua.includes("openrolekb");
      const disallow = trimmed.match(/^disallow:\s*(.+)$/i)?.[1]?.trim();
      if (applies && disallow && disallow !== "/" && path.startsWith(disallow)) return false;
      if (applies && disallow === "/") return false;
    }
  } catch {
    return true;
  }
  return true;
}

export async function discoverFromSitemaps(options: DiscoveryOptions = {}): Promise<Candidate[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates: Candidate[] = [];
  for (const ats of selectedAts(options)) {
    for (const page of CUSTOMER_PAGES[ats]) {
      const url = new URL(page);
      if (!(await robotsAllows(url, fetchImpl))) continue;
      try {
        const res = await fetchImpl(url, { headers: { "User-Agent": "OpenRoleKB-ats-discovery/0.1" } });
        if (!res.ok) continue;
        const html = await res.text();
        candidates.push(...extractCandidatesFromText(html, "sitemap"));
      } catch {
        // Marketing pages are a bonus source; ignore transient failures.
      }
    }
  }
  return dedupeCandidates(candidates.filter((c) => selectedAts(options).includes(c.ats)));
}

export async function discoverFromCorpusHints(options: DiscoveryOptions = {}): Promise<Candidate[]> {
  const rows = await prisma.job.findMany({ select: { url: true }, where: { source: { in: selectedAts(options) } } });
  const candidates = rows
    .map((row) => extractCandidateFromUrl(row.url, `hint:${row.url}`))
    .filter((c): c is Candidate => Boolean(c))
    .filter((c) => selectedAts(options).includes(c.ats));
  return dedupeCandidates(candidates);
}

export async function discoverCandidates(
  sources: Array<"exa" | "sitemap" | "hints"> = ["exa", "sitemap", "hints"],
  options: DiscoveryOptions = {},
): Promise<{ candidates: Candidate[]; exaCalls: number; bySource: Record<string, number> }> {
  const all: Candidate[] = [];
  const bySource: Record<string, number> = {};
  let exaCalls = 0;

  if (sources.includes("exa")) {
    const res = await discoverFromExa(options);
    exaCalls += res.exaCalls;
    bySource.exa = res.candidates.length;
    all.push(...res.candidates);
  }
  if (sources.includes("sitemap")) {
    const res = await discoverFromSitemaps(options);
    bySource.sitemap = res.length;
    all.push(...res);
  }
  if (sources.includes("hints")) {
    const res = await discoverFromCorpusHints(options);
    bySource.hints = res.length;
    all.push(...res);
  }

  return { candidates: dedupeCandidates(all), exaCalls, bySource };
}
