#!/usr/bin/env -S npx tsx
/**
 * Ashby direct-ingestion adapter.
 *
 * Fetches the public Ashby Posting API for a curated list of company slugs,
 * normalizes into the existing Job table shape, and upserts. Read-only against
 * Ashby; writes to the Job table only.
 *
 * Usage:
 *   npx tsx scripts/ingest-ashby.ts                # ingest all default slugs
 *   npx tsx scripts/ingest-ashby.ts --dry-run      # fetch + print, do NOT write
 *   npx tsx scripts/ingest-ashby.ts --slugs a,b,c  # override slug list
 *   npx tsx scripts/ingest-ashby.ts --include-discovered # merge verified AtsTenant slugs
 *
 * Reference: https://developers.ashbyhq.com/reference/posting-api
 */
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";
import type { PrismaClient } from "../generated/prisma/client";

// Verified-working Ashby board slugs (probed 2026-06-09).
const DEFAULT_SLUGS = [
  // Global tech — verified 2026-06-09
  "linear",
  "replit",
  "posthog",
  "runway",
  "granola",
  "cursor",
  // Indian tech — verified 2026-06-09 (from india_marketfit_research.sh probe)
  "scaler",
  "navi",
  "ditto",
];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const INCLUDE_DISCOVERED = flag("--include-discovered");
const slugsArg = argValue("--slugs");
const BASE_SLUGS = slugsArg ? slugsArg.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_SLUGS;

interface AshbySummaryComponent {
  label?: string;
  summary?: string;
  currencyCode?: string;
  intervalCode?: string;
  min?: number;
  max?: number;
  value?: number;
}

interface AshbyCompensation {
  compensationTierSummary?: string | null;
  summaryComponents?: AshbySummaryComponent[];
}

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  location?: string;
  isRemote?: boolean;
  publishedAt?: string;
  compensation?: AshbyCompensation;
  employmentType?: string;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
  jobBoard?: { name?: string };
}

interface PerSlugStats {
  slug: string;
  fetched: number;
  upserted: number;
  errors: number;
  hadSalary: number;
  hadRemoteFlag: number;
  status: "ok" | "fetch_failed";
  errorMsg?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Lazy prisma so --dry-run doesn't require DATABASE_URL.
let prismaInstance: PrismaClient | null = null;
async function getPrisma(): Promise<PrismaClient> {
  if (!prismaInstance) {
    const mod = await import("@/lib/prisma");
    prismaInstance = mod.prisma as PrismaClient;
  }
  return prismaInstance;
}

async function loadSlugs(): Promise<string[]> {
  if (!INCLUDE_DISCOVERED) return BASE_SLUGS;
  const prisma = await getPrisma();
  const discovered = await prisma.atsTenant.findMany({
    where: { ats: "ashby", status: "verified" },
    select: { slug: true },
    orderBy: [{ hasIndianJobs: "desc" }, { jobsLastSeen: "desc" }],
  });
  return Array.from(new Set([...BASE_SLUGS, ...discovered.map((row) => row.slug)]));
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

function detectRemote(isRemoteFlag: boolean | undefined, location: string | undefined, description: string): boolean | null {
  if (isRemoteFlag === true) return true;
  if (isRemoteFlag === false) return false;
  const haystack = `${location ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

/**
 * Extract salary from Ashby's structured compensation.summaryComponents if present
 * and currency is USD. Falls back to text extraction from the description.
 */
function extractAshbySalary(
  comp: AshbyCompensation | undefined,
  description: string,
): { min?: number; max?: number; raw?: string } {
  if (comp?.summaryComponents && comp.summaryComponents.length > 0) {
    const usdComp = comp.summaryComponents.find(
      (c) => c.currencyCode === "USD" && (c.min != null || c.max != null),
    );
    if (usdComp) {
      return {
        min: usdComp.min ?? undefined,
        max: usdComp.max ?? undefined,
        raw: comp.compensationTierSummary ?? usdComp.summary ?? undefined,
      };
    }
  }
  return extractSalary(description);
}

async function fetchBoard(slug: string): Promise<{ jobs: AshbyJob[]; companyName: string }> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "OpenRoleKB-ingest-poc/0.1 (+https://github.com/himanshu-nakrani/OpenRoleKB)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as AshbyResponse;
  const jobs = data.jobs ?? [];
  const companyName = data.jobBoard?.name?.trim() || slug;
  return { jobs, companyName };
}

async function ingestSlug(slug: string): Promise<PerSlugStats> {
  const stats: PerSlugStats = {
    slug,
    fetched: 0,
    upserted: 0,
    errors: 0,
    hadSalary: 0,
    hadRemoteFlag: 0,
    status: "ok",
  };

  let jobs: AshbyJob[];
  let companyName: string;
  try {
    const result = await fetchBoard(slug);
    jobs = result.jobs;
    companyName = result.companyName;
  } catch (err) {
    stats.status = "fetch_failed";
    stats.errorMsg = err instanceof Error ? err.message : String(err);
    return stats;
  }

  stats.fetched = jobs.length;
  if (jobs.length === 0) return stats;

  for (const j of jobs) {
    try {
      // Prefer plain text; fall back to stripping HTML
      const description = j.descriptionPlain
        ? j.descriptionPlain.trim()
        : j.descriptionHtml
          ? stripHtml(j.descriptionHtml)
          : "";

      const locationRaw = j.location?.trim() || null;
      const location = normalizeLocation(locationRaw);
      const isRemote = detectRemote(j.isRemote, locationRaw ?? undefined, description);
      if (isRemote === true) stats.hadRemoteFlag++;

      const salary = extractAshbySalary(j.compensation, description);
      if (salary.min || salary.max || salary.raw) stats.hadSalary++;

      const dedupKey = createHash("sha256")
        .update(
          `${j.title.toLowerCase().trim()}|${companyName.toLowerCase()}|${(location || "").toLowerCase()}`,
        )
        .digest("hex");

      const publishedAt = j.publishedAt ? new Date(j.publishedAt) : null;
      // Prefer applyUrl (canonical apply link) over jobUrl (Ashby-hosted page)
      const url = j.applyUrl || j.jobUrl;

      if (DRY_RUN) {
        stats.upserted++;
        continue;
      }

      const prisma = await getPrisma();
      await prisma.job.upsert({
        where: { url },
        create: {
          url,
          title: j.title,
          company: companyName,
          location,
          locationRaw,
          isRemote,
          description,
          publishedAt,
          source: "ashby",
          salaryMinUsd: salary.min,
          salaryMaxUsd: salary.max,
          salaryRaw: salary.raw,
          dedupKey,
        },
        update: {
          title: j.title,
          company: companyName,
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
    } catch (err) {
      stats.errors++;
      console.error(
        `  [${slug}] job ${j.id} upsert failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return stats;
}

async function main() {
  const SLUGS = await loadSlugs();
  console.log(`Ashby ingestion — ${SLUGS.length} slug(s), dry-run=${DRY_RUN}, include-discovered=${INCLUDE_DISCOVERED}\n`);
  const t0 = Date.now();
  const allStats: PerSlugStats[] = [];

  for (const slug of SLUGS) {
    process.stdout.write(`  fetching ${slug} … `);
    const t = Date.now();
    const stats = await ingestSlug(slug);
    const ms = Date.now() - t;
    if (stats.status === "fetch_failed") {
      console.log(`FAIL (${stats.errorMsg}) ${ms}ms`);
    } else {
      console.log(
        `ok  fetched=${stats.fetched} upserted=${stats.upserted} salary=${stats.hadSalary} remote=${stats.hadRemoteFlag} ${ms}ms`,
      );
    }
    allStats.push(stats);
    await sleep(150);
  }

  const totalMs = Date.now() - t0;
  const totals = allStats.reduce(
    (acc, s) => ({
      slugs_ok: acc.slugs_ok + (s.status === "ok" ? 1 : 0),
      slugs_failed: acc.slugs_failed + (s.status === "fetch_failed" ? 1 : 0),
      fetched: acc.fetched + s.fetched,
      upserted: acc.upserted + s.upserted,
      hadSalary: acc.hadSalary + s.hadSalary,
      hadRemoteFlag: acc.hadRemoteFlag + s.hadRemoteFlag,
      errors: acc.errors + s.errors,
    }),
    { slugs_ok: 0, slugs_failed: 0, fetched: 0, upserted: 0, hadSalary: 0, hadRemoteFlag: 0, errors: 0 },
  );

  console.log("\n=== Summary ===");
  console.log(`Slugs:        ${totals.slugs_ok} ok, ${totals.slugs_failed} failed`);
  console.log(`Jobs fetched: ${totals.fetched}`);
  console.log(`Upserted:     ${totals.upserted} ${DRY_RUN ? "(dry-run)" : ""}`);
  console.log(`With salary:  ${totals.hadSalary} (${pct(totals.hadSalary, totals.upserted)})`);
  console.log(`With remote:  ${totals.hadRemoteFlag} (${pct(totals.hadRemoteFlag, totals.upserted)})`);
  console.log(`Upsert errors: ${totals.errors}`);
  console.log(`Wall time:    ${totalMs}ms`);

  const failed = allStats.filter((s) => s.status === "fetch_failed");
  if (failed.length) {
    console.log("\nFailed slugs (probably wrong/changed slug):");
    for (const s of failed) console.log(`  - ${s.slug}: ${s.errorMsg}`);
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
