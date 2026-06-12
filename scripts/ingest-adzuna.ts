#!/usr/bin/env -S npx tsx
/**
 * Adzuna aggregator ingestion adapter.
 *
 * Adzuna provides an aggregated job feed across many companies and locations.
 * This adapter is useful for thin-geography coverage: roles that don't appear
 * on Greenhouse/Lever/Ashby/SR/Workday can surface here, especially in India.
 *
 * API docs: https://developer.adzuna.com/
 * Free tier: 250 calls/month. We cap aggressively to protect the quota.
 *
 * Usage:
 *   npx tsx scripts/ingest-adzuna.ts                 # ingest default countries
 *   npx tsx scripts/ingest-adzuna.ts --dry-run        # fetch + print, do NOT write
 *   npx tsx scripts/ingest-adzuna.ts --countries in   # India only
 *   npx tsx scripts/ingest-adzuna.ts --max-calls 20   # override cap
 *
 * Env vars required:
 *   ADZUNA_APP_ID   — from https://developer.adzuna.com/
 *   ADZUNA_APP_KEY  — from https://developer.adzuna.com/
 *
 * Dedup strategy:
 *   1. URL match (exact) — catches ATS postings we already have.
 *   2. SHA-256 (company_lower | title_lower | location_lower) — catches
 *      Adzuna-specific duplicates where URL differs across scrape runs.
 */
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";
import type { PrismaClient } from "../generated/prisma/client";

// ── Countries to ingest (ISO 2-letter codes supported by Adzuna) ──────────────
// India (in): strong thin-geography value — many startups not on ATS we cover.
// US (us):    backup for roles that slip through primary ATS adapters.
const DEFAULT_COUNTRIES = ["in", "us"];
const RESULTS_PER_PAGE = 50; // Adzuna max is 50
const DEFAULT_MAX_CALLS = 50; // ≤ 250/mo free tier limit
const SLEEP_BETWEEN_CALLS_MS = 1100; // polite: ~1 req/s

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const countriesArg = argValue("--countries");
const COUNTRIES = countriesArg ? countriesArg.split(",").map((c) => c.trim()) : DEFAULT_COUNTRIES;
const maxCallsArg = argValue("--max-calls");
const MAX_CALLS = maxCallsArg ? parseInt(maxCallsArg, 10) : DEFAULT_MAX_CALLS;

// ── Adzuna API types ──────────────────────────────────────────────────────────
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
  contract_type?: string;
}

interface AdzunaResponse {
  results?: AdzunaJob[];
  count?: number;
}

interface PerCountryStats {
  country: string;
  fetched: number;
  upserted: number;
  errors: number;
  skippedDuplicate: number;
  hadSalary: number;
  hadRemoteFlag: number;
  callsUsed: number;
  status: "ok" | "fetch_failed" | "no_credentials";
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

function detectRemote(location: string | undefined, description: string): boolean | null {
  const haystack = `${location ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

/**
 * Build salary fields from Adzuna's structured fields.
 * Adzuna salary_min/max are in local currency; for India they are INR,
 * for US they are USD. We use the existing extractSalary as a cross-check.
 */
function buildSalary(
  job: AdzunaJob,
  country: string,
  description: string,
): { min?: number; max?: number; raw?: string } {
  const INR_TO_USD = 0.012;
  const hasSalary = job.salary_min != null || job.salary_max != null;

  if (hasSalary && job.salary_is_predicted !== 1) {
    // Real (non-predicted) salary data from Adzuna
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
      // Assume USD for "us"
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

  // Fall back to text extraction from description
  return extractSalary(description);
}

// ── Dedup check ───────────────────────────────────────────────────────────────
/**
 * Returns true if a job with this URL or dedupKey already exists in the DB.
 * We check both to avoid re-ingesting ATS postings we already have.
 */
async function isDuplicate(url: string, dedupKey: string): Promise<boolean> {
  const prisma = await getPrisma();
  const byUrl = await prisma.job.findUnique({ where: { url }, select: { id: true } });
  if (byUrl) return true;
  const byDedup = await prisma.job.findFirst({ where: { dedupKey }, select: { id: true } });
  return !!byDedup;
}

// ── Fetch one page from Adzuna ────────────────────────────────────────────────
async function fetchPage(
  appId: string,
  appKey: string,
  country: string,
  page: number,
): Promise<AdzunaResponse> {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(RESULTS_PER_PAGE),
    "content-type": "application/json",
  });
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "OpenRoleKB-ingest-poc/0.1 (+https://github.com/himanshu-nakrani/OpenRoleKB)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`AUTH ${res.status} — check ADZUNA_APP_ID / ADZUNA_APP_KEY`);
    }
    if (res.status === 429) {
      throw new Error(`RATE_LIMIT 429 — monthly quota exhausted or throttled`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as AdzunaResponse;
}

// ── Per-country ingestion ─────────────────────────────────────────────────────
async function ingestCountry(
  appId: string,
  appKey: string,
  country: string,
  callBudget: number,
): Promise<PerCountryStats> {
  const stats: PerCountryStats = {
    country,
    fetched: 0,
    upserted: 0,
    errors: 0,
    skippedDuplicate: 0,
    hadSalary: 0,
    hadRemoteFlag: 0,
    callsUsed: 0,
    status: "ok",
  };

  let page = 1;
  let totalFromApi = Infinity;

  while (stats.callsUsed < callBudget && stats.fetched < totalFromApi) {
    let data: AdzunaResponse;
    try {
      data = await fetchPage(appId, appKey, country, page);
      stats.callsUsed++;
    } catch (err) {
      if (page === 1) {
        stats.status = "fetch_failed";
        stats.errorMsg = err instanceof Error ? err.message : String(err);
        return stats;
      }
      console.warn(`  [adzuna/${country}] page ${page} failed: ${err instanceof Error ? err.message : err}`);
      break;
    }

    if (totalFromApi === Infinity) totalFromApi = data.count ?? 0;
    const jobs = data.results ?? [];
    if (jobs.length === 0) break;
    stats.fetched += jobs.length;

    for (const job of jobs) {
      try {
        const company = job.company?.display_name?.trim() || "Unknown";
        const title = job.title?.trim() || "";
        if (!title) continue;

        const description = job.description?.trim() ?? "";
        const locationRaw =
          job.location?.display_name?.trim() ||
          job.location?.area?.filter(Boolean).join(", ") ||
          null;
        const location = normalizeLocation(locationRaw);
        const isRemote = detectRemote(locationRaw ?? undefined, description);
        if (isRemote === true) stats.hadRemoteFlag++;

        const salary = buildSalary(job, country, description);
        if (salary.min || salary.max || salary.raw) stats.hadSalary++;

        const url = job.redirect_url;
        const dedupKey = createHash("sha256")
          .update(
            `${title.toLowerCase()}|${company.toLowerCase()}|${(location || "").toLowerCase()}`,
          )
          .digest("hex");

        // Dedup check (only needed when actually writing)
        if (!DRY_RUN) {
          const dup = await isDuplicate(url, dedupKey);
          if (dup) {
            stats.skippedDuplicate++;
            continue;
          }
        }

        const publishedAt = job.created ? new Date(job.created) : null;

        if (DRY_RUN) {
          stats.upserted++;
          continue;
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
            source: "adzuna",
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
      } catch (err) {
        stats.errors++;
        console.error(
          `  [adzuna/${country}] job ${job.id} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    page++;
    if (stats.callsUsed < callBudget) await sleep(SLEEP_BETWEEN_CALLS_MS);
  }

  return stats;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    console.error(
      "BLOCKER: ADZUNA_APP_ID and ADZUNA_APP_KEY env vars are required.\n" +
        "Register for a free key at https://developer.adzuna.com/\n" +
        "Add them to .env.local or export them before running.",
    );
    process.exit(1);
  }

  console.log(
    `Adzuna ingestion — countries=${COUNTRIES.join(",")}, max-calls=${MAX_CALLS}, dry-run=${DRY_RUN}\n`,
  );
  console.log(
    `  ⚠  Adzuna free tier: 250 calls/month. This run will use at most ${MAX_CALLS} calls.\n`,
  );

  const t0 = Date.now();
  const allStats: PerCountryStats[] = [];
  let remainingCalls = MAX_CALLS;

  for (const country of COUNTRIES) {
    if (remainingCalls <= 0) {
      console.log(`  [${country}] skipped — call budget exhausted`);
      continue;
    }
    const perCountry = Math.ceil(remainingCalls / (COUNTRIES.length - allStats.length));
    process.stdout.write(`  [${country}] fetching (budget=${perCountry} calls) … `);
    const t = Date.now();
    const stats = await ingestCountry(appId, appKey, country, perCountry);
    const ms = Date.now() - t;
    remainingCalls -= stats.callsUsed;

    if (stats.status === "fetch_failed") {
      console.log(`FAIL (${stats.errorMsg}) ${ms}ms`);
    } else {
      console.log(
        `ok  fetched=${stats.fetched} upserted=${stats.upserted} dup_skipped=${stats.skippedDuplicate} calls=${stats.callsUsed} salary=${stats.hadSalary} remote=${stats.hadRemoteFlag} ${ms}ms`,
      );
    }
    allStats.push(stats);
  }

  const totalMs = Date.now() - t0;
  const totals = allStats.reduce(
    (acc, s) => ({
      ok: acc.ok + (s.status === "ok" ? 1 : 0),
      failed: acc.failed + (s.status !== "ok" ? 1 : 0),
      fetched: acc.fetched + s.fetched,
      upserted: acc.upserted + s.upserted,
      skippedDuplicate: acc.skippedDuplicate + s.skippedDuplicate,
      hadSalary: acc.hadSalary + s.hadSalary,
      hadRemoteFlag: acc.hadRemoteFlag + s.hadRemoteFlag,
      callsUsed: acc.callsUsed + s.callsUsed,
      errors: acc.errors + s.errors,
    }),
    {
      ok: 0,
      failed: 0,
      fetched: 0,
      upserted: 0,
      skippedDuplicate: 0,
      hadSalary: 0,
      hadRemoteFlag: 0,
      callsUsed: 0,
      errors: 0,
    },
  );

  console.log("\n=== Summary ===");
  console.log(`Countries:    ${totals.ok} ok, ${totals.failed} failed`);
  console.log(`Jobs fetched: ${totals.fetched}`);
  console.log(`Upserted:     ${totals.upserted}${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`Dup skipped:  ${totals.skippedDuplicate}`);
  console.log(`With salary:  ${totals.hadSalary} (${pct(totals.hadSalary, totals.fetched)})`);
  console.log(`With remote:  ${totals.hadRemoteFlag} (${pct(totals.hadRemoteFlag, totals.fetched)})`);
  console.log(`API calls:    ${totals.callsUsed} / ${MAX_CALLS} (${MAX_CALLS - totals.callsUsed} remaining this run)`);
  console.log(`Errors:       ${totals.errors}`);
  console.log(`Wall time:    ${totalMs}ms`);

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
