#!/usr/bin/env -S npx tsx
/**
 * Lever direct-ingestion adapter.
 *
 * Fetches the public Lever Posting API for a curated list of company slugs,
 * normalizes into the existing Job table shape, and upserts. Read-only against
 * Lever; writes to the Job table only.
 *
 * Usage:
 *   npx tsx scripts/ingest-lever.ts                # ingest all default slugs
 *   npx tsx scripts/ingest-lever.ts --dry-run      # fetch + print, do NOT write
 *   npx tsx scripts/ingest-lever.ts --slugs a,b,c  # override slug list
 *   npx tsx scripts/ingest-lever.ts --include-discovered # merge verified AtsTenant slugs
 *
 * Reference: https://hire.lever.co/developer/postings
 */
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";
import { isDenylistedTenant } from "@/lib/ats-tenant-denylist";
import type { PrismaClient } from "../generated/prisma/client";

// Verified-working Lever board slugs (probed 2026-06-09).
// Global tech companies that use Lever as their primary ATS.
// Indian slugs: cred, meesho (confirmed with live jobs).
const DEFAULT_SLUGS = [
  // Global tech — verified 2026-06-09
  "spotify",
  "palantir",
  "whoop",
  "zoox",
  "immuta",
  // Indian tech — verified 2026-06-09
  "cred",
  "meesho",
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

interface LeverCategories {
  location?: string;
  commitment?: string;
  team?: string;
}

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  descriptionPlain?: string;
  description?: string;
  additional?: string;
  categories?: LeverCategories;
  createdAt?: number;
  lists?: Array<{ text?: string; content?: string }>;
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
  if (!INCLUDE_DISCOVERED) return BASE_SLUGS.filter((s) => !isDenylistedTenant("lever", s));
  const prisma = await getPrisma();
  const discovered = await prisma.atsTenant.findMany({
    where: { ats: "lever", status: "verified" },
    select: { slug: true },
    orderBy: [{ hasIndianJobs: "desc" }, { jobsLastSeen: "desc" }],
  });
  const merged = Array.from(new Set([...BASE_SLUGS, ...discovered.map((row) => row.slug)]));
  return merged.filter((s) => !isDenylistedTenant("lever", s));
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

function detectRemote(location: string | undefined, description: string): boolean | null {
  const haystack = `${location ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

/** Convert a slug like "eight-sleep" to "Eight Sleep" */
function slugToCompanyName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function fetchPostings(slug: string): Promise<LeverPosting[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "OpenRoleKB-ingest-poc/0.1 (+https://github.com/himanshu-nakrani/OpenRoleKB)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as LeverPosting[] | { error?: string };
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected response shape: ${JSON.stringify(data).slice(0, 120)}`);
  }
  return data;
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

  let postings: LeverPosting[];
  try {
    postings = await fetchPostings(slug);
  } catch (err) {
    stats.status = "fetch_failed";
    stats.errorMsg = err instanceof Error ? err.message : String(err);
    return stats;
  }

  stats.fetched = postings.length;
  if (postings.length === 0) return stats;

  const companyName = slugToCompanyName(slug);

  for (const p of postings) {
    try {
      // Prefer plain text; fall back to stripping HTML description + additional
      const descriptionParts: string[] = [];
      if (p.descriptionPlain) {
        descriptionParts.push(p.descriptionPlain.trim());
      } else if (p.description) {
        descriptionParts.push(stripHtml(p.description));
      }
      if (p.additional) {
        descriptionParts.push(stripHtml(p.additional));
      }
      const description = descriptionParts.join(" ").replace(/\s+/g, " ").trim();

      const locationRaw = p.categories?.location?.trim() || null;
      const location = normalizeLocation(locationRaw);
      const isRemote = detectRemote(locationRaw ?? undefined, description);
      if (isRemote === true) stats.hadRemoteFlag++;

      const salary = description ? extractSalary(description) : {};
      if (salary.min || salary.max || salary.raw) stats.hadSalary++;

      const dedupKey = createHash("sha256")
        .update(
          `${p.text.toLowerCase().trim()}|${companyName.toLowerCase()}|${(location || "").toLowerCase()}`,
        )
        .digest("hex");

      const publishedAt = p.createdAt ? new Date(p.createdAt) : null;
      const url = p.hostedUrl;

      if (DRY_RUN) {
        stats.upserted++;
        continue;
      }

      const prisma = await getPrisma();
      await prisma.job.upsert({
        where: { url },
        create: {
          url,
          title: p.text,
          company: companyName,
          location,
          locationRaw,
          isRemote,
          description,
          publishedAt,
          source: "lever",
          salaryMinUsd: salary.min,
          salaryMaxUsd: salary.max,
          salaryRaw: salary.raw,
          dedupKey,
        },
        update: {
          title: p.text,
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
        `  [${slug}] posting ${p.id} upsert failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return stats;
}

async function main() {
  const SLUGS = await loadSlugs();
  console.log(`Lever ingestion — ${SLUGS.length} slug(s), dry-run=${DRY_RUN}, include-discovered=${INCLUDE_DISCOVERED}\n`);
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
