#!/usr/bin/env -S npx tsx
/**
 * Greenhouse direct-ingestion POC.
 *
 * Fetches the public Greenhouse Job Board API for a curated list of
 * well-known company slugs, normalizes into the existing Job table shape,
 * and upserts. Read-only against Greenhouse; writes to the Job table only.
 *
 * Usage:
 *   npx tsx scripts/ingest-greenhouse.ts                # ingest all default slugs
 *   npx tsx scripts/ingest-greenhouse.ts --dry-run      # fetch + print, do NOT write
 *   npx tsx scripts/ingest-greenhouse.ts --slugs a,b,c  # override slug list
 *   npx tsx scripts/ingest-greenhouse.ts --include-discovered # merge verified AtsTenant slugs
 *
 * Reference: https://developers.greenhouse.io/job-board.html
 */
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { isDenylistedTenant } from "@/lib/ats-tenant-denylist";
import { extractSalary } from "@/lib/salary";
import type { PrismaClient } from "../generated/prisma/client";

// Verified-working Greenhouse board tokens (probed 2026-06-06). Companies
// that no longer host their board on Greenhouse (Shopify, DoorDash, OpenAI,
// Ramp, Plaid, Notion, etc.) are excluded — they'll be picked up when the
// Lever and Ashby adapters land.
const DEFAULT_SLUGS = [
  "airbnb",
  "stripe",
  "gitlab",
  "vercel",
  "anthropic",
  "discord",
  "reddit",
  "asana",
  "robinhood",
  "duolingo",
  "instacart",
  "figma",
  "scaleai",
  "brex",
  "datadog",
  "coinbase",
  "pinterest",
  "dropbox",
  "mongodb",
  "intercom",
  "twilio",
  // India batch — 9 verified slugs probed 2026-06-07 (~602 jobs total)
  "phonepe",
  "postman",
  "groww",
  "druva",
  "highradius",
  "slice",
  "karbon",
  "fivetran",
  "tcs",
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

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  updated_at?: string;
  first_published?: string;
  company_name?: string;
  content?: string;
  metadata?: Array<{ name?: string; value?: unknown }>;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string }>;
}

interface GhResponse {
  jobs?: GhJob[];
  meta?: { total?: number };
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
  if (!INCLUDE_DISCOVERED) return BASE_SLUGS.filter((s) => !isDenylistedTenant("greenhouse", s));
  const prisma = await getPrisma();
  const discovered = await prisma.atsTenant.findMany({
    where: { ats: "greenhouse", status: "verified" },
    select: { slug: true },
    orderBy: [{ hasIndianJobs: "desc" }, { jobsLastSeen: "desc" }],
  });
  const merged = Array.from(new Set([...BASE_SLUGS, ...discovered.map((row) => row.slug)]));
  return merged.filter((s) => !isDenylistedTenant("greenhouse", s));
}


function stripHtml(html: string): string {
  // Cheap text extraction. Greenhouse `content` is HTML-escaped HTML;
  // we don't need a parser for storage — just need readable text for the
  // existing extractSalary regex pass and for rerank's text input.
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

async function fetchBoard(slug: string): Promise<GhJob[]> {
  // ?content=true returns full HTML descriptions in the same call (no per-job follow-ups)
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": "OpenRoleKB-ingest-poc/0.1 (+https://github.com/himanshu-nakrani/OpenRoleKB)" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as GhResponse;
  return data.jobs ?? [];
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

  let jobs: GhJob[];
  try {
    jobs = await fetchBoard(slug);
  } catch (err) {
    stats.status = "fetch_failed";
    stats.errorMsg = err instanceof Error ? err.message : String(err);
    return stats;
  }

  stats.fetched = jobs.length;
  if (jobs.length === 0) return stats;

  // Greenhouse board company name is normally on every job
  const companyFromBoard = jobs[0]?.company_name?.trim() || slug;

  for (const j of jobs) {
    try {
      const description = j.content ? stripHtml(j.content) : "";
      const locationRaw = j.location?.name?.trim() || null;
      const location = normalizeLocation(locationRaw);
      const isRemote = detectRemote(locationRaw ?? undefined, description);
      if (isRemote === true) stats.hadRemoteFlag++;

      const salary = description ? extractSalary(description) : {};
      if (salary.min || salary.max || salary.raw) stats.hadSalary++;

      const dedupKey = createHash("sha256")
        .update(`${j.title.toLowerCase().trim()}|${companyFromBoard.toLowerCase()}|${(location || "").toLowerCase()}`)
        .digest("hex");

      const publishedAt = j.first_published ? new Date(j.first_published) : null;

      if (DRY_RUN) {
        stats.upserted++; // counted, just not written
        continue;
      }

      const prisma = await getPrisma();
      await prisma.job.upsert({
        where: { url: j.absolute_url },
        create: {
          url: j.absolute_url,
          title: j.title,
          company: companyFromBoard,
          location,
          locationRaw,
          isRemote,
          description,
          publishedAt,
          source: "greenhouse",
          salaryMinUsd: salary.min,
          salaryMaxUsd: salary.max,
          salaryRaw: salary.raw,
          dedupKey,
        },
        update: {
          title: j.title,
          company: companyFromBoard,
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
      console.error(`  [${slug}] job ${j.id} upsert failed:`, err instanceof Error ? err.message : err);
    }
  }

  return stats;
}

async function main() {
  const SLUGS = await loadSlugs();
  console.log(`Greenhouse ingestion POC — ${SLUGS.length} slug(s), dry-run=${DRY_RUN}, include-discovered=${INCLUDE_DISCOVERED}\n`);
  const t0 = Date.now();
  const allStats: PerSlugStats[] = [];

  // Sequential to be gentle on the public API and to keep logs readable.
  // 20 slugs × ~200 jobs/board × ~5ms upsert = single-digit minutes, fine.
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
    await sleep(150); // polite pause between boards
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

  // Print failed slugs explicitly so the seed list can be pruned.
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
