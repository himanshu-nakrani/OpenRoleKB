#!/usr/bin/env -S npx tsx
/**
 * Workday direct-ingestion adapter.
 *
 * Workday tenants expose a public JSON API at:
 *   POST https://<tenant>.<region>.myworkdayjobs.com/wday/cxs/<tenant>/<board>/jobs
 *
 * The API requires a session cookie + X-Calypso-CSRF-Token header, obtained by
 * first GET-ing the careers page (https://<tenant>.<region>.myworkdayjobs.com/en-US/<board>).
 * Job descriptions require a separate detail fetch per posting.
 *
 * Usage:
 *   npx tsx scripts/ingest-workday.ts                # ingest all default tenants
 *   npx tsx scripts/ingest-workday.ts --dry-run      # fetch + print, do NOT write
 *   npx tsx scripts/ingest-workday.ts --tenants nvidia,workday  # override list
 *
 * Polite operation:
 *   - 1 req/s minimum per tenant (1000 ms between requests)
 *   - Exponential back-off on 429 / 5xx (up to 4 retries)
 *   - Job detail responses are cached in memory by externalPath across offsets
 */
import { createHash } from "node:crypto";
import { normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";
import type { PrismaClient } from "../generated/prisma/client";

// ── Tenant registry ──────────────────────────────────────────────────────────
// Hand-curated and verified 2026-06-09. Each entry was probed live:
//   curl -s https://<tenant>.<region>.myworkdayjobs.com/en-US/<board> → 200
//   + subsequent POST /jobs → { total: N }
//
// Tenants that require additional SSO / Cloudflare JS challenge (Microsoft,
// Amazon, Google, Netflix, etc.) return 500 on the careers page and cannot
// be scripted without a headless browser — they are excluded.
export const DEFAULT_TENANTS: TenantConfig[] = [
  // ── US Fortune 500 / Global Tech ──────────────────────────────────────────
  {
    key: "nvidia",
    tenant: "nvidia",
    region: "wd5",
    board: "NVIDIAExternalCareerSite",
    company: "NVIDIA",
  },
  {
    key: "intel",
    tenant: "intel",
    region: "wd1",
    board: "External",
    company: "Intel",
  },
  {
    key: "workday",
    tenant: "workday",
    region: "wd5",
    board: "Workday",
    company: "Workday",
  },
  {
    key: "hpe",
    tenant: "hpe",
    region: "wd5",
    board: "Jobsathpe",
    company: "Hewlett Packard Enterprise",
  },
  {
    key: "pnc",
    tenant: "pnc",
    region: "wd5",
    board: "External",
    company: "PNC Financial Services",
  },
  {
    key: "tmobile",
    tenant: "tmobile",
    region: "wd1",
    board: "External",
    company: "T-Mobile",
  },
  {
    key: "travelers",
    tenant: "travelers",
    region: "wd5",
    board: "External",
    company: "Travelers",
  },
];

// ── Config & CLI ──────────────────────────────────────────────────────────────
const PAGE_SIZE = 20; // Workday default
const DETAIL_SLEEP_MS = 1100; // ≥1 req/s per tenant
const LIST_SLEEP_MS = 1100;
const MAX_BACKOFF_RETRIES = 4;

const USER_AGENT = "OpenRoleKB-Bot/1.0 (+https://github.com/himanshu-nakrani/OpenRoleKB)";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const tenantsArg = argValue("--tenants");
const TENANTS = tenantsArg
  ? tenantsArg.split(",").map((k) => {
      const found = DEFAULT_TENANTS.find((t) => t.key === k.trim());
      if (!found) throw new Error(`Unknown tenant key: "${k}". Valid keys: ${DEFAULT_TENANTS.map((t) => t.key).join(", ")}`);
      return found;
    })
  : DEFAULT_TENANTS;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TenantConfig {
  key: string;
  tenant: string;
  region: string;
  board: string;
  company: string; // display name override; Workday API doesn't always expose it
}

interface WdJobPosting {
  title: string;
  externalPath: string; // e.g. "/job/US-CA-Santa-Clara/Engineer_JR123"
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[]; // [0] is often the req ID
}

interface WdListResponse {
  total?: number;
  jobPostings?: WdJobPosting[];
}

interface WdJobDetail {
  id?: string;
  title?: string;
  jobDescription?: string;
  location?: string;
  additionalLocations?: string[];
  postedOn?: string;
  startDate?: string;
  timeType?: string;
  jobReqId?: string;
  externalUrl?: string;
}

interface WdDetailResponse {
  jobPostingInfo?: WdJobDetail;
}

interface PerTenantStats {
  key: string;
  company: string;
  fetched: number;
  upserted: number;
  errors: number;
  hadSalary: number;
  hadRemoteFlag: number;
  status: "ok" | "fetch_failed";
  errorMsg?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let prismaInstance: PrismaClient | null = null;
async function getPrisma(): Promise<PrismaClient> {
  if (!prismaInstance) {
    const mod = await import("@/lib/prisma");
    prismaInstance = mod.prisma as PrismaClient;
  }
  return prismaInstance;
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

/** Fetch with exponential back-off on 429 / 5xx. */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_BACKOFF_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok || res.status === 404) return res; // 404 = posting gone, treat as ok
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const delay = Math.min(2 ** attempt * 2000, 30_000); // 2s, 4s, 8s, 16s, cap 30s
      console.warn(`    [backoff] HTTP ${res.status} on ${url} — retry in ${delay}ms`);
      await sleep(delay);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("Unreachable");
}

// ── Session management ─────────────────────────────────────────────────────────
interface WdSession {
  cookieHeader: string;
  csrfToken: string;
}

/**
 * Establish a Workday session by fetching the public careers page.
 * The page sets CALYPSO_CSRF_TOKEN and PLAY_SESSION cookies which are
 * required for subsequent API calls.
 */
async function establishSession(cfg: TenantConfig): Promise<WdSession> {
  const pageUrl = `https://${cfg.tenant}.${cfg.region}.myworkdayjobs.com/en-US/${cfg.board}`;
  const res = await fetchWithRetry(pageUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`Session page returned HTTP ${res.status}: ${pageUrl}`);
  }

  // Extract Set-Cookie headers
  const raw = res.headers.get("set-cookie") ?? "";
  // `fetch` on Node.js merges all Set-Cookie into one header separated by commas
  // which is lossy for cookie values containing commas. We work around this by
  // re-splitting on the known cookie names.
  const cookieMap: Record<string, string> = {};
  for (const part of raw.split(/,(?=[A-Za-z_-]+=)/)) {
    const nameVal = part.trim().split(";")[0];
    if (!nameVal) continue;
    const eq = nameVal.indexOf("=");
    if (eq < 0) continue;
    const name = nameVal.slice(0, eq).trim();
    const value = nameVal.slice(eq + 1).trim();
    cookieMap[name] = value;
  }

  const csrfToken = cookieMap["CALYPSO_CSRF_TOKEN"] ?? "";
  if (!csrfToken) {
    // Some tenants work without a CSRF token (first-load path)
    // Continue anyway; the list POST will fail fast if it truly requires one.
    console.warn(`  [warn] No CALYPSO_CSRF_TOKEN in session for ${cfg.key}`);
  }

  const cookieHeader = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  return { cookieHeader, csrfToken };
}

// ── Fetch functions ────────────────────────────────────────────────────────────
async function fetchJobList(
  cfg: TenantConfig,
  session: WdSession,
  offset: number,
): Promise<WdListResponse> {
  const url = `https://${cfg.tenant}.${cfg.region}.myworkdayjobs.com/wday/cxs/${cfg.tenant}/${cfg.board}/jobs`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Cookie: session.cookieHeader,
      "X-Calypso-CSRF-Token": session.csrfToken,
      Origin: `https://${cfg.tenant}.${cfg.region}.myworkdayjobs.com`,
      Referer: `https://${cfg.tenant}.${cfg.region}.myworkdayjobs.com/en-US/${cfg.board}`,
    },
    body: JSON.stringify({
      appliedFacets: {},
      limit: PAGE_SIZE,
      offset,
      searchText: "",
    }),
  });
  return (await res.json()) as WdListResponse;
}

async function fetchJobDetail(
  cfg: TenantConfig,
  session: WdSession,
  externalPath: string,
): Promise<WdJobDetail | null> {
  // externalPath is already URL-encoded by Workday (e.g. "/job/US-CA/Title_JR123")
  const url = `https://${cfg.tenant}.${cfg.region}.myworkdayjobs.com/wday/cxs/${cfg.tenant}/${cfg.board}${externalPath}`;
  let res: Response;
  try {
    res = await fetchWithRetry(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Cookie: session.cookieHeader,
        "X-Calypso-CSRF-Token": session.csrfToken,
      },
    });
  } catch (err) {
    console.warn(`    detail fetch failed: ${externalPath} — ${err instanceof Error ? err.message : err}`);
    return null;
  }
  if (res.status === 404) return null;
  const data = (await res.json()) as WdDetailResponse;
  return data.jobPostingInfo ?? null;
}

// ── In-memory detail cache (externalPath → detail) ─────────────────────────────
const detailCache = new Map<string, WdJobDetail | null>();

// ── Per-tenant ingestion ───────────────────────────────────────────────────────
async function ingestTenant(cfg: TenantConfig): Promise<PerTenantStats> {
  const stats: PerTenantStats = {
    key: cfg.key,
    company: cfg.company,
    fetched: 0,
    upserted: 0,
    errors: 0,
    hadSalary: 0,
    hadRemoteFlag: 0,
    status: "ok",
  };

  let session: WdSession;
  try {
    session = await establishSession(cfg);
  } catch (err) {
    stats.status = "fetch_failed";
    stats.errorMsg = `session: ${err instanceof Error ? err.message : String(err)}`;
    return stats;
  }

  // Paginate
  let offset = 0;
  let total = Infinity;
  let firstPage = true;

  while (offset < total) {
    let listData: WdListResponse;
    try {
      listData = await fetchJobList(cfg, session, offset);
    } catch (err) {
      if (firstPage) {
        stats.status = "fetch_failed";
        stats.errorMsg = `list: ${err instanceof Error ? err.message : String(err)}`;
        return stats;
      }
      // Partial failure — stop pagination but keep what we have
      console.warn(`  [${cfg.key}] list fetch failed at offset=${offset}: ${err instanceof Error ? err.message : err}`);
      break;
    }
    firstPage = false;

    if (total === Infinity) total = listData.total ?? 0;
    const postings = listData.jobPostings ?? [];
    if (postings.length === 0) break;
    stats.fetched += postings.length;

    for (const posting of postings) {
      const externalPath = posting.externalPath;
      await sleep(DETAIL_SLEEP_MS);

      // Cache check
      let detail: WdJobDetail | null;
      if (detailCache.has(externalPath)) {
        detail = detailCache.get(externalPath)!;
      } else {
        detail = await fetchJobDetail(cfg, session, externalPath);
        detailCache.set(externalPath, detail);
      }

      try {
        const title = (detail?.title ?? posting.title).trim();
        const descHtml = detail?.jobDescription ?? "";
        const description = descHtml ? stripHtml(descHtml) : "";
        const locationRaw = (detail?.location ?? posting.locationsText ?? "").trim() || null;
        const location = normalizeLocation(locationRaw);
        const isRemote = detectRemote(locationRaw ?? undefined, description);
        if (isRemote === true) stats.hadRemoteFlag++;

        const salary = description ? extractSalary(description) : {};
        if (salary.min || salary.max || salary.raw) stats.hadSalary++;

        // Canonical URL: prefer externalUrl from detail (company ATS page),
        // fall back to the Workday-hosted page.
        const externalUrl =
          detail?.externalUrl?.trim() ||
          `https://${cfg.tenant}.${cfg.region}.myworkdayjobs.com/en-US/${cfg.board}${externalPath}`;

        // postedOn is a human string like "Posted Today", "Posted 3 Days Ago"
        // We don't have a parseable date from the listing; skip publishedAt.
        const publishedAt: Date | null = null;

        const dedupKey = createHash("sha256")
          .update(`${title.toLowerCase()}|${cfg.company.toLowerCase()}|${(location || "").toLowerCase()}`)
          .digest("hex");

        if (DRY_RUN) {
          stats.upserted++;
          continue;
        }

        const prisma = await getPrisma();
        await prisma.job.upsert({
          where: { url: externalUrl },
          create: {
            url: externalUrl,
            title,
            company: cfg.company,
            location,
            locationRaw,
            isRemote,
            description,
            publishedAt,
            source: "workday",
            salaryMinUsd: salary.min,
            salaryMaxUsd: salary.max,
            salaryRaw: salary.raw,
            dedupKey,
          },
          update: {
            title,
            company: cfg.company,
            location,
            locationRaw,
            isRemote,
            description,
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
          `  [${cfg.key}] upsert failed for ${externalPath}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    offset += postings.length;
    if (offset < total) await sleep(LIST_SLEEP_MS);
  }

  return stats;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Workday ingestion — ${TENANTS.length} tenant(s), dry-run=${DRY_RUN}\n`);
  const t0 = Date.now();
  const allStats: PerTenantStats[] = [];

  for (const cfg of TENANTS) {
    process.stdout.write(`  [${cfg.key}] fetching ${cfg.company} … `);
    const t = Date.now();
    const stats = await ingestTenant(cfg);
    const ms = Date.now() - t;
    if (stats.status === "fetch_failed") {
      console.log(`FAIL (${stats.errorMsg}) ${ms}ms`);
    } else {
      console.log(
        `ok  fetched=${stats.fetched} upserted=${stats.upserted} salary=${stats.hadSalary} remote=${stats.hadRemoteFlag} ${ms}ms`,
      );
    }
    allStats.push(stats);
    // No inter-tenant sleep needed; polite rate limiting is per-request above.
  }

  const totalMs = Date.now() - t0;
  const totals = allStats.reduce(
    (acc, s) => ({
      ok: acc.ok + (s.status === "ok" ? 1 : 0),
      failed: acc.failed + (s.status === "fetch_failed" ? 1 : 0),
      fetched: acc.fetched + s.fetched,
      upserted: acc.upserted + s.upserted,
      hadSalary: acc.hadSalary + s.hadSalary,
      hadRemoteFlag: acc.hadRemoteFlag + s.hadRemoteFlag,
      errors: acc.errors + s.errors,
    }),
    { ok: 0, failed: 0, fetched: 0, upserted: 0, hadSalary: 0, hadRemoteFlag: 0, errors: 0 },
  );

  console.log("\n=== Summary ===");
  console.log(`Tenants:      ${totals.ok} ok, ${totals.failed} failed`);
  console.log(`Jobs fetched: ${totals.fetched}`);
  console.log(`Upserted:     ${totals.upserted}${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`With salary:  ${totals.hadSalary} (${pct(totals.hadSalary, totals.upserted)})`);
  console.log(`With remote:  ${totals.hadRemoteFlag} (${pct(totals.hadRemoteFlag, totals.upserted)})`);
  console.log(`Upsert errors: ${totals.errors}`);
  console.log(`Wall time:    ${totalMs}ms`);

  const failed = allStats.filter((s) => s.status === "fetch_failed");
  if (failed.length) {
    console.log("\nFailed tenants:");
    for (const s of failed) console.log(`  - ${s.key} (${s.company}): ${s.errorMsg}`);
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
