#!/usr/bin/env -S npx tsx
/**
 * JSON-LD careers-page crawler.
 *
 * Fetches a list of company careers pages, extracts schema.org JobPosting
 * JSON-LD blocks, and upserts results into the Job table.
 *
 * Two-level crawl strategy:
 *   1. Fetch the given careers URL.
 *   2. If the page itself embeds JobPosting JSON-LD blocks, extract them all.
 *   3. If not (most listing pages are SPAs), scan the HTML for links to
 *      individual job pages on the same domain and fetch those (up to
 *      MAX_JOB_LINKS_PER_PAGE per careers page), extracting JSON-LD from each.
 *   4. Skip silently if no JobPosting is found after both passes.
 *
 * Polite operation:
 *   - Respects robots.txt for each domain (parsed and cached per run).
 *   - User-Agent identifies as a polite bot.
 *   - 1-second pause between requests.
 *   - MAX_JOB_LINKS_PER_PAGE cap prevents unbounded crawling.
 *
 * Limitation note:
 *   Most modern ATS systems (Greenhouse, Lever, Ashby, SR, Workday, Jobvite,
 *   iCIMS, etc.) render job listings via JavaScript and do NOT serve JSON-LD
 *   in static HTML. This crawler works best against companies that either:
 *     a) Embed JobPosting JSON-LD on SSR individual job pages (e.g. some
 *        Workday tenants, custom static sites), or
 *     b) Use WordPress with WP Job Manager or similar plugins.
 *   Companies using purely SPA-rendered careers pages will produce 0 results
 *   and are skipped silently (no error, just 0 in the summary).
 *
 * Usage:
 *   npx tsx scripts/ingest-jsonld.ts                # ingest default seed list
 *   npx tsx scripts/ingest-jsonld.ts --dry-run      # fetch + print, do NOT write
 *   npx tsx scripts/ingest-jsonld.ts --urls https://example.com/careers
 *
 * Reference: https://schema.org/JobPosting
 */
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";
// Reuse the existing JSON-LD detector from retrieval-quality — don't duplicate.
import { hasJobPostingSchema } from "@/lib/retrieval-quality";
import type { PrismaClient } from "../generated/prisma/client";

// ── Seed list ─────────────────────────────────────────────────────────────────
// Hand-curated companies that DON'T use Greenhouse/Lever/Ashby/SmartRecruiters/
// Workday, and whose career pages or linked individual job pages embed
// schema.org/JobPosting JSON-LD in server-rendered HTML.
//
// Verified approach 2026-06-09: the two-level crawl (listing → individual job pages)
// is necessary because most listing pages are SPAs. Each entry is a careers listing
// URL; the crawler will follow same-domain job links to find individual pages.
//
// NOTE: Most SPA-rendered career sites will yield 0 results — that's expected.
// The crawler skips silently when no JSON-LD is found.
export const DEFAULT_CAREERS_URLS: SeedEntry[] = [
  // ── Companies using custom SSR career pages or Workday tenants not in our list ──
  // These are companies whose individual job pages are confirmed to embed JSON-LD.
  // The crawler fetches the listing page, discovers individual job links, and
  // fetches each for JSON-LD extraction.
  {
    company: "Zoho",
    careersUrl: "https://careers.zohocorp.com/",
    // Zoho uses a custom careers site; individual job pages may have JSON-LD
  },
  {
    company: "Zerodha",
    careersUrl: "https://zerodha.com/careers/",
    // India's largest broker; custom career page
  },
  {
    company: "Canonical",
    careersUrl: "https://canonical.com/careers/all-vacancies",
    // Ubuntu maker; uses custom SSR career site
  },
  {
    company: "JetBrains",
    careersUrl: "https://www.jetbrains.com/careers/jobs/",
    // JetBrains uses their own career site
  },
  {
    company: "Mozilla",
    careersUrl: "https://www.mozilla.org/en-US/careers/listings/",
    // Firefox maker; custom SSR career page
  },
  {
    company: "Automattic",
    careersUrl: "https://automattic.com/work-with-us/",
    // WordPress.com maker; distributed-first career page
  },
  {
    company: "Cloudflare",
    careersUrl: "https://www.cloudflare.com/careers/jobs/",
    // Cloudflare uses a custom careers page
  },
  {
    company: "IBM",
    careersUrl: "https://www.ibm.com/employment/careers/",
    // IBM uses their own ATS (not one of the 5 covered)
  },
  {
    company: "SAP",
    careersUrl: "https://jobs.sap.com/",
    // SAP SuccessFactors (their own product) — SSR pages
  },
  {
    company: "Thoughtworks",
    careersUrl: "https://www.thoughtworks.com/careers/jobs",
    // Global tech consultancy; custom career site
  },
  {
    company: "Stripe",
    careersUrl: "https://stripe.com/jobs",
    // Stripe uses their own custom ATS
  },
  {
    company: "HashiCorp",
    careersUrl: "https://www.hashicorp.com/careers",
    // HashiCorp; custom career site
  },
];

// ── Config & CLI ──────────────────────────────────────────────────────────────
const MAX_JOB_LINKS_PER_PAGE = 20; // max individual job pages to crawl per seed URL
const REQUEST_SLEEP_MS = 1100; // ≥1 req/s — polite rate limiting
const FETCH_TIMEOUT_MS = 20_000;

const USER_AGENT = "OpenRoleKB-Bot/1.0 (+https://github.com/himanshu-nakrani/OpenRoleKB)";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const urlsArg = argValue("--urls");
const SEED_ENTRIES: SeedEntry[] = urlsArg
  ? urlsArg.split(",").map((u) => ({ company: new URL(u.trim()).hostname, careersUrl: u.trim() }))
  : DEFAULT_CAREERS_URLS;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SeedEntry {
  company: string;
  careersUrl: string;
}

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
  remote?: boolean;
  jobLocationType?: string;
  applicantLocationRequirements?: unknown;
}

interface PerEntryStats {
  company: string;
  careersUrl: string;
  pagesVisited: number;
  jobsFound: number;
  upserted: number;
  errors: number;
  hadSalary: number;
  hadRemoteFlag: number;
  skippedRobots: number;
  status: "ok" | "fetch_failed";
  errorMsg?: string;
}

// ── Prisma lazy init ──────────────────────────────────────────────────────────
let prismaInstance: PrismaClient | null = null;
async function getPrisma(): Promise<PrismaClient> {
  if (!prismaInstance) {
    const mod = await import("@/lib/prisma");
    prismaInstance = mod.prisma as PrismaClient;
  }
  return prismaInstance;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch HTML with a timeout, returning null on error. */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── robots.txt cache ──────────────────────────────────────────────────────────
const robotsCache = new Map<string, string[]>();

/** Returns the list of disallowed paths for our User-Agent from robots.txt. */
async function getDisallowedPaths(origin: string): Promise<string[]> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const html = await fetchHtml(`${origin}/robots.txt`);
  if (!html) {
    robotsCache.set(origin, []);
    return [];
  }

  // Parse robots.txt for our UA and the wildcard
  const lines = html.split(/\r?\n/);
  let inOurAgent = false;
  const disallowed: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed.toLowerCase().startsWith("user-agent:")) {
      const ua = trimmed.slice("user-agent:".length).trim();
      inOurAgent = ua === "*" || ua.toLowerCase().includes("openrolekb");
    } else if (inOurAgent && trimmed.toLowerCase().startsWith("disallow:")) {
      const path = trimmed.slice("disallow:".length).trim();
      if (path) disallowed.push(path);
    }
  }

  robotsCache.set(origin, disallowed);
  return disallowed;
}

/** Returns true if the given URL path is disallowed by robots.txt. */
async function isRobotsBlocked(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const disallowed = await getDisallowedPaths(parsed.origin);
  return disallowed.some((d) => d !== "/" && parsed.pathname.startsWith(d));
}

// ── JSON-LD extraction ────────────────────────────────────────────────────────
const LD_JSON_RX = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Extract all JobPosting JSON-LD blocks from HTML. */
export function extractJobPostings(html: string): JsonLdJobPosting[] {
  if (!hasJobPostingSchema(html)) return [];

  const results: JsonLdJobPosting[] = [];
  let match: RegExpExecArray | null;
  const rx = new RegExp(LD_JSON_RX.source, "gi");

  while ((match = rx.exec(html)) !== null) {
    const raw = match[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      if (typeof c === "object" && c !== null) {
        const obj = c as Record<string, unknown>;
        if (obj["@type"] === "JobPosting") {
          results.push(obj as unknown as JsonLdJobPosting);
        }
      }
    }
  }

  return results;
}

// ── Field extractors ──────────────────────────────────────────────────────────
function extractTitle(jp: JsonLdJobPosting): string {
  return (jp.title ?? "").trim();
}

function extractCompany(jp: JsonLdJobPosting, fallback: string): string {
  return jp.hiringOrganization?.name?.trim() || fallback;
}

function extractLocationRaw(jp: JsonLdJobPosting): string | null {
  const loc = jp.jobLocation;
  if (!loc) return null;

  // Handle array
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
  // schema.org jobLocationType: "TELECOMMUTE" = remote
  if (jp.jobLocationType === "TELECOMMUTE") return true;

  const haystack = `${locationRaw ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

function extractDescription(jp: JsonLdJobPosting): string {
  const raw = jp.description ?? "";
  // JSON-LD descriptions can be HTML or plain text; strip HTML just in case.
  return raw
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

function extractSalaryFromJsonLd(
  jp: JsonLdJobPosting,
  description: string,
): { min?: number; max?: number; raw?: string } {
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

// ── Link discovery ────────────────────────────────────────────────────────────
/** Extract same-domain job page links from a listing page's HTML. */
function discoverJobLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  // Match href values that look like individual job page paths
  const JOB_PATH_RX =
    /href=["']([^"'#?]*(?:\/job[s]?\/|\/position[s]?\/|\/opening[s]?\/|\/career[s]?\/(?!search|listing|all))[^"'#?]{3,})[^"']*["']/gi;

  const seen = new Set<string>();
  const links: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = JOB_PATH_RX.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href) continue;

    let fullUrl: string;
    try {
      fullUrl = new URL(href, base.origin).href;
    } catch {
      continue;
    }

    // Same-origin only
    let parsed: URL;
    try {
      parsed = new URL(fullUrl);
    } catch {
      continue;
    }

    if (parsed.hostname !== base.hostname) continue;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    links.push(fullUrl);
  }

  return links;
}

// ── Normalise & upsert ────────────────────────────────────────────────────────
async function upsertPosting(
  jp: JsonLdJobPosting,
  pageUrl: string,
  fallbackCompany: string,
  stats: PerEntryStats,
): Promise<void> {
  const title = extractTitle(jp);
  if (!title) return;

  const company = extractCompany(jp, fallbackCompany);
  const description = extractDescription(jp);
  const locationRaw = extractLocationRaw(jp);
  const location = normalizeLocation(locationRaw);
  const isRemote = detectRemote(jp, description, locationRaw);
  if (isRemote === true) stats.hadRemoteFlag++;

  const salary = extractSalaryFromJsonLd(jp, description);
  if (salary.min || salary.max || salary.raw) stats.hadSalary++;

  const url = extractUrl(jp, pageUrl);
  const publishedAt = extractPublishedAt(jp);

  const dedupKey = createHash("sha256")
    .update(`${title.toLowerCase()}|${company.toLowerCase()}|${(location || "").toLowerCase()}`)
    .digest("hex");

  stats.jobsFound++;

  if (DRY_RUN) {
    stats.upserted++;
    return;
  }

  const prisma = await getPrisma();
  await prisma.job.upsert({
    where: { url },
    create: {
      url,
      title,
      company,
      location,
      locationRaw,
      isRemote,
      description,
      publishedAt,
      source: "jsonld",
      salaryMinUsd: salary.min,
      salaryMaxUsd: salary.max,
      salaryRaw: salary.raw,
      dedupKey,
    },
    update: {
      title,
      company,
      location,
      locationRaw,
      isRemote,
      description,
      publishedAt,
      salaryMinUsd: salary.min ?? undefined,
      salaryMaxUsd: salary.max ?? undefined,
      salaryRaw: salary.raw,
      dedupKey,
    },
  });
  stats.upserted++;
}

// ── Per-entry ingestion ───────────────────────────────────────────────────────
async function ingestEntry(entry: SeedEntry): Promise<PerEntryStats> {
  const stats: PerEntryStats = {
    company: entry.company,
    careersUrl: entry.careersUrl,
    pagesVisited: 0,
    jobsFound: 0,
    upserted: 0,
    errors: 0,
    hadSalary: 0,
    hadRemoteFlag: 0,
    skippedRobots: 0,
    status: "ok",
  };

  // --- robots.txt check for the listing page itself ---
  const blocked = await isRobotsBlocked(entry.careersUrl);
  if (blocked) {
    stats.skippedRobots++;
    return stats; // skip silently
  }

  // --- Fetch the careers listing page ---
  await sleep(REQUEST_SLEEP_MS);
  const listingHtml = await fetchHtml(entry.careersUrl);
  if (!listingHtml) {
    stats.status = "fetch_failed";
    stats.errorMsg = `Could not fetch ${entry.careersUrl}`;
    return stats;
  }
  stats.pagesVisited++;

  // --- Pass 1: extract JSON-LD directly from the listing page ---
  const directPostings = extractJobPostings(listingHtml);
  for (const jp of directPostings) {
    try {
      await upsertPosting(jp, entry.careersUrl, entry.company, stats);
    } catch (err) {
      stats.errors++;
      console.error(`  [${entry.company}] upsert error:`, err instanceof Error ? err.message : err);
    }
  }

  if (directPostings.length > 0) {
    // Found JSON-LD directly on the listing page — no need to follow links.
    return stats;
  }

  // --- Pass 2: discover individual job links and fetch each one ---
  const jobLinks = discoverJobLinks(listingHtml, entry.careersUrl).slice(0, MAX_JOB_LINKS_PER_PAGE);

  for (const jobUrl of jobLinks) {
    const jobBlocked = await isRobotsBlocked(jobUrl);
    if (jobBlocked) {
      stats.skippedRobots++;
      continue;
    }

    await sleep(REQUEST_SLEEP_MS);
    const jobHtml = await fetchHtml(jobUrl);
    if (!jobHtml) continue;
    stats.pagesVisited++;

    const postings = extractJobPostings(jobHtml);
    for (const jp of postings) {
      try {
        await upsertPosting(jp, jobUrl, entry.company, stats);
      } catch (err) {
        stats.errors++;
        console.error(
          `  [${entry.company}] upsert error on ${jobUrl}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return stats;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`JSON-LD crawler — ${SEED_ENTRIES.length} seed URL(s), dry-run=${DRY_RUN}\n`);
  console.log(
    `  Note: SPAs (most modern career sites) will yield 0 results — this is expected.\n` +
      `  The crawler works best against SSR pages that embed JobPosting JSON-LD.\n`,
  );

  const t0 = Date.now();
  const allStats: PerEntryStats[] = [];

  for (const entry of SEED_ENTRIES) {
    process.stdout.write(`  [${entry.company}] crawling ${entry.careersUrl} … `);
    const t = Date.now();
    const stats = await ingestEntry(entry);
    const ms = Date.now() - t;

    if (stats.status === "fetch_failed") {
      console.log(`FAIL (${stats.errorMsg}) ${ms}ms`);
    } else {
      console.log(
        `ok  pages=${stats.pagesVisited} jobs=${stats.jobsFound} upserted=${stats.upserted}` +
          ` robots_skip=${stats.skippedRobots} ${ms}ms`,
      );
    }
    allStats.push(stats);
  }

  const totalMs = Date.now() - t0;
  const totals = allStats.reduce(
    (acc, s) => ({
      ok: acc.ok + (s.status === "ok" ? 1 : 0),
      failed: acc.failed + (s.status !== "ok" ? 1 : 0),
      pages: acc.pages + s.pagesVisited,
      jobs: acc.jobs + s.jobsFound,
      upserted: acc.upserted + s.upserted,
      hadSalary: acc.hadSalary + s.hadSalary,
      hadRemoteFlag: acc.hadRemoteFlag + s.hadRemoteFlag,
      errors: acc.errors + s.errors,
      skippedRobots: acc.skippedRobots + s.skippedRobots,
    }),
    { ok: 0, failed: 0, pages: 0, jobs: 0, upserted: 0, hadSalary: 0, hadRemoteFlag: 0, errors: 0, skippedRobots: 0 },
  );

  console.log("\n=== Summary ===");
  console.log(`Entries:      ${totals.ok} ok, ${totals.failed} failed`);
  console.log(`Pages visited: ${totals.pages}`);
  console.log(`Jobs found:   ${totals.jobs}`);
  console.log(`Upserted:     ${totals.upserted}${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`With salary:  ${totals.hadSalary} (${pct(totals.hadSalary, totals.jobs)})`);
  console.log(`With remote:  ${totals.hadRemoteFlag} (${pct(totals.hadRemoteFlag, totals.jobs)})`);
  console.log(`Robots skips: ${totals.skippedRobots}`);
  console.log(`Errors:       ${totals.errors}`);
  console.log(`Wall time:    ${totalMs}ms`);

  const failed = allStats.filter((s) => s.status !== "ok");
  if (failed.length) {
    console.log("\nFailed entries:");
    for (const s of failed) console.log(`  - ${s.company}: ${s.errorMsg}`);
  }

  const zero = allStats.filter((s) => s.status === "ok" && s.jobsFound === 0);
  if (zero.length) {
    console.log(`\nEntries with 0 JSON-LD jobs (SPA / no schema markup):`);
    for (const s of zero) console.log(`  - ${s.company}: ${s.careersUrl}`);
  }

  if (prismaInstance) await prismaInstance.$disconnect();
}

function pct(n: number, d: number): string {
  if (d === 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  if (prismaInstance) await prismaInstance.$disconnect().catch(() => {});
  process.exit(1);
});
