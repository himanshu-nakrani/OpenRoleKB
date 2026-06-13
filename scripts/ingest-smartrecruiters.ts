#!/usr/bin/env -S npx tsx
/**
 * SmartRecruiters direct-ingestion adapter.
 *
 * Fetches the public SmartRecruiters Posting API for a curated list of
 * company slugs, normalizes into the existing Job table shape, and upserts.
 * Read-only against SmartRecruiters; writes to the Job table only.
 *
 * The list endpoint does NOT include job descriptions — each posting requires
 * a detail fetch. To stay polite, we fetch at most MAX_DETAIL_PER_SLUG detail
 * records in dry-run mode. Production ingest can lift this cap.
 *
 * Usage:
 *   npx tsx scripts/ingest-smartrecruiters.ts                # ingest all default slugs
 *   npx tsx scripts/ingest-smartrecruiters.ts --dry-run      # fetch + print, do NOT write
 *   npx tsx scripts/ingest-smartrecruiters.ts --slugs a,b,c  # override slug list
 *   npx tsx scripts/ingest-smartrecruiters.ts --include-discovered # merge verified AtsTenant slugs
 *
 * Reference: https://dev.smartrecruiters.com/customer-api/live-docs/posting-api/
 */
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { isDenylistedTenant } from "@/lib/ats-tenant-denylist";
import { extractSalary } from "@/lib/salary";
import type { PrismaClient } from "../generated/prisma/client";

// Verified-working SmartRecruiters board slugs (probed 2026-06-09).
// India slugs confirmed: freshworks(49), unacademy(3), whatfix(1), cars24(1).
// Global: visa(15). Other candidates (bosch, marriott, ikea, siemens, costco) returned 0.
const DEFAULT_SLUGS = [
  // India — verified 2026-06-09
  "freshworks",
  "unacademy",
  "whatfix",
  "cars24",
  // Global — verified 2026-06-09
  "visa",
];

// In dry-run we still fetch details to print realistic data, but cap per slug
// to keep the run fast. Production ingest should lift or remove this cap.
const MAX_DETAIL_PER_SLUG = 50;
const LIST_PAGE_LIMIT = 100;
const DETAIL_SLEEP_MS = 50; // polite pause between detail fetches

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

interface SRLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  fullLocation?: string;
}

interface SRPosting {
  id: string;
  name: string;
  company?: { name?: string; identifier?: string };
  releasedDate?: string;
  location?: SRLocation;
  typeOfEmployment?: { label?: string };
  experienceLevel?: { label?: string };
  ref: string;
}

interface SRListResponse {
  totalFound?: number;
  content?: SRPosting[];
}

interface SRSection {
  text?: string;
}

interface SRDetail {
  id: string;
  name: string;
  company?: { name?: string };
  applyUrl?: string;
  postingUrl?: string;
  releasedDate?: string;
  location?: SRLocation;
  jobAd?: {
    sections?: {
      companyDescription?: SRSection;
      jobDescription?: SRSection;
      qualifications?: SRSection;
      additionalInformation?: SRSection;
    };
  };
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
  if (!INCLUDE_DISCOVERED) return BASE_SLUGS.filter((s) => !isDenylistedTenant("smartrecruiters", s));
  const prisma = await getPrisma();
  const discovered = await prisma.atsTenant.findMany({
    where: { ats: "smartrecruiters", status: "verified" },
    select: { slug: true },
    orderBy: [{ hasIndianJobs: "desc" }, { jobsLastSeen: "desc" }],
  });
  const merged = Array.from(new Set([...BASE_SLUGS, ...discovered.map((row) => row.slug)]));
  return merged.filter((s) => !isDenylistedTenant("smartrecruiters", s));
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

function detectRemote(srLocation: SRLocation | undefined, description: string): boolean | null {
  if (srLocation?.remote === true) return true;
  if (srLocation?.remote === false) {
    // Double-check against description text in case field is wrong
    const haystack = `${srLocation.fullLocation ?? ""} ${description.slice(0, 800)}`.toLowerCase();
    if (/\bremote\b/.test(haystack)) return true;
    return false;
  }
  const haystack = `${srLocation?.fullLocation ?? ""} ${description.slice(0, 800)}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return true;
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(haystack)) return false;
  return null;
}

const USER_AGENT = "OpenRoleKB-ingest-poc/0.1 (+https://github.com/himanshu-nakrani/OpenRoleKB)";

async function fetchList(slug: string): Promise<SRPosting[]> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=${LIST_PAGE_LIMIT}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as SRListResponse;
  return data.content ?? [];
}

async function fetchDetail(detailUrl: string): Promise<SRDetail> {
  const res = await fetch(detailUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${detailUrl}`);
  return (await res.json()) as SRDetail;
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

  let postings: SRPosting[];
  try {
    postings = await fetchList(slug);
  } catch (err) {
    stats.status = "fetch_failed";
    stats.errorMsg = err instanceof Error ? err.message : String(err);
    return stats;
  }

  stats.fetched = postings.length;
  if (postings.length === 0) return stats;

  // Cap detail fetches per slug to stay polite in dry-run; prod ingest can lift.
  const toProcess = postings.slice(0, MAX_DETAIL_PER_SLUG);

  for (const p of toProcess) {
    try {
      let detail: SRDetail;
      try {
        detail = await fetchDetail(p.ref);
        await sleep(DETAIL_SLEEP_MS);
      } catch (err) {
        stats.errors++;
        console.error(
          `  [${slug}] detail fetch failed for ${p.id}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      const sections = detail.jobAd?.sections ?? {};
      const descriptionParts = [
        sections.companyDescription?.text,
        sections.jobDescription?.text,
        sections.qualifications?.text,
        sections.additionalInformation?.text,
      ]
        .filter(Boolean)
        .map((t) => stripHtml(t!));
      const description = descriptionParts.join(" ").replace(/\s+/g, " ").trim();

      const srLoc = detail.location ?? p.location;
      const locationRaw = srLoc?.fullLocation?.trim() || null;
      const location = normalizeLocation(locationRaw);
      const isRemote = detectRemote(srLoc, description);
      if (isRemote === true) stats.hadRemoteFlag++;

      const salary = description ? extractSalary(description) : {};
      if (salary.min || salary.max || salary.raw) stats.hadSalary++;

      const companyName = detail.company?.name?.trim() || p.company?.name?.trim() || slug;

      const dedupKey = createHash("sha256")
        .update(
          `${p.name.toLowerCase().trim()}|${companyName.toLowerCase()}|${(location || "").toLowerCase()}`,
        )
        .digest("hex");

      const publishedAt = (detail.releasedDate ?? p.releasedDate)
        ? new Date(detail.releasedDate ?? p.releasedDate!)
        : null;

      // Prefer the canonical apply URL from detail; fall back to the posting page.
      const url = detail.applyUrl || detail.postingUrl || p.ref;

      if (DRY_RUN) {
        stats.upserted++;
        continue;
      }

      const prisma = await getPrisma();
      await prisma.job.upsert({
        where: { url },
        create: {
          url,
          title: p.name,
          company: companyName,
          location,
          locationRaw,
          isRemote,
          description,
          publishedAt,
          source: "smartrecruiters",
          salaryMinUsd: salary.min,
          salaryMaxUsd: salary.max,
          salaryRaw: salary.raw,
          dedupKey,
        },
        update: {
          title: p.name,
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
  console.log(`SmartRecruiters ingestion — ${SLUGS.length} slug(s), dry-run=${DRY_RUN}, include-discovered=${INCLUDE_DISCOVERED}\n`);
  console.log(
    `  Note: detail fetch capped at ${MAX_DETAIL_PER_SLUG}/slug for polite operation. Prod ingest can lift this.\n`,
  );
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
        `ok  fetched=${stats.fetched} processed=${stats.upserted} salary=${stats.hadSalary} remote=${stats.hadRemoteFlag} ${ms}ms`,
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
  console.log(`Jobs fetched (list): ${totals.fetched}`);
  console.log(`Jobs processed (detail + upsert): ${totals.upserted} ${DRY_RUN ? "(dry-run)" : ""}`);
  console.log(`With salary:  ${totals.hadSalary} (${pct(totals.hadSalary, totals.upserted)})`);
  console.log(`With remote:  ${totals.hadRemoteFlag} (${pct(totals.hadRemoteFlag, totals.upserted)})`);
  console.log(`Detail errors: ${totals.errors}`);
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
