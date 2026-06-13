#!/usr/bin/env -S npx tsx
import { discoverCandidates, SUPPORTED_ATS, type Ats, type Candidate } from "@/lib/ats-discovery";
import { verifyTenant, type VerificationResult } from "@/lib/ats-verify";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const argValue = (name: string) => {
  const prefix = `${name}=`;
  const inline = args.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DRY_RUN = flag("--dry-run");
const VERIFY_ONLY = flag("--verify-only");
const SOURCES = (argValue("--sources") ?? "exa,sitemap,hints")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as Array<"exa" | "sitemap" | "hints">;
const ATS_FILTER = (argValue("--ats")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) as Ats[];
const MAX_EXA_CALLS = Number(process.env.ATS_DISCOVERY_MAX_EXA_CALLS ?? argValue("--max-exa-calls") ?? 25);
const LIMIT = Number(argValue("--limit") ?? process.env.ATS_DISCOVERY_LIMIT ?? 0);

function validateAts(values: Ats[]): Ats[] {
  for (const value of values) {
    if (!(SUPPORTED_ATS as readonly string[]).includes(value)) {
      throw new Error(`Unsupported --ats=${value}; expected one of ${SUPPORTED_ATS.join(",")}`);
    }
  }
  return values.length ? values : [...SUPPORTED_ATS];
}

function statusFromVerification(v: VerificationResult): string {
  return v.status;
}

async function existingKeys(): Promise<Set<string>> {
  const rows = await prisma.atsTenant.findMany({ select: { ats: true, slug: true } });
  return new Set(rows.map((r) => `${r.ats}:${r.slug}`));
}

function countBy<T extends string>(items: T[]): Record<T, number> {
  return items.reduce((acc, item) => ({ ...acc, [item]: (acc[item] ?? 0) + 1 }), {} as Record<T, number>);
}

async function candidatesForVerifyOnly(ats: Ats[]): Promise<Candidate[]> {
  const rows = await prisma.atsTenant.findMany({
    where: { ats: { in: ats }, status: { in: ["candidate", "rate_limited", "verified"] } },
    orderBy: [{ hasIndianJobs: "desc" }, { discoveredAt: "asc" }],
    take: LIMIT || undefined,
  });
  return rows.map((row) => ({ ats: row.ats as Ats, slug: row.slug, source: row.source, hint: row.companyName ?? undefined }));
}

async function persist(candidate: Candidate, verification: VerificationResult) {
  const now = new Date();
  const status = statusFromVerification(verification);
  await prisma.atsTenant.upsert({
    where: { ats_slug: { ats: candidate.ats, slug: candidate.slug } },
    create: {
      ats: candidate.ats,
      slug: candidate.slug,
      companyName: verification.companyName ?? candidate.hint,
      verifiedAt: verification.ok ? now : undefined,
      status,
      jobsLastSeen: verification.jobCount,
      hasIndianJobs: verification.hasIndianJobs,
      source: candidate.source,
      notes: verification.error,
    },
    update: {
      companyName: verification.companyName ?? candidate.hint ?? undefined,
      verifiedAt: verification.ok ? now : undefined,
      status,
      jobsLastSeen: verification.jobCount,
      hasIndianJobs: verification.hasIndianJobs,
      notes: verification.error ?? null,
    },
  });
}

async function main() {
  const ats = validateAts(ATS_FILTER);
  console.log(`ATS tenant discovery — dry-run=${DRY_RUN} verify-only=${VERIFY_ONLY} ats=${ats.join(",")} sources=${SOURCES.join(",")} maxExa=${MAX_EXA_CALLS}`);

  let candidates: Candidate[] = [];
  let bySource: Record<string, number> = {};
  let exaCalls = 0;

  if (VERIFY_ONLY) {
    candidates = await candidatesForVerifyOnly(ats);
    bySource = { verify_only: candidates.length };
  } else {
    const discovered = await discoverCandidates(SOURCES, { ats, maxExaCalls: MAX_EXA_CALLS });
    bySource = discovered.bySource;
    exaCalls = discovered.exaCalls;
    const existing = await existingKeys();
    candidates = discovered.candidates.filter((c) => !existing.has(`${c.ats}:${c.slug}`));
    if (LIMIT > 0) candidates = candidates.slice(0, LIMIT);
  }

  const perAts = countBy(candidates.map((c) => c.ats));
  console.log("Discovered candidates (new/selected):", candidates.length, perAts);
  console.log("By source:", bySource);

  const outcomes: Array<{ candidate: Candidate; verification: VerificationResult }> = [];
  for (const candidate of candidates) {
    process.stdout.write(`  verifying ${candidate.ats}:${candidate.slug} … `);
    const verification = await verifyTenant(candidate.ats, candidate.slug);
    outcomes.push({ candidate, verification });
    console.log(`${verification.status} jobs=${verification.jobCount} india=${verification.hasIndianJobs}${verification.error ? ` err=${verification.error}` : ""}`);
    if (!DRY_RUN) await persist(candidate, verification);
  }

  const statuses = countBy(outcomes.map((o) => o.verification.status));
  const topIndian = outcomes
    .filter((o) => o.verification.ok && o.verification.hasIndianJobs)
    .sort((a, b) => b.verification.jobCount - a.verification.jobCount)
    .slice(0, 10);

  console.log("\n=== Summary ===");
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Verification:`, statuses);
  console.log(`Exa calls used: ${exaCalls}`);
  console.log("\nTop Indian tenants:");
  for (const row of topIndian) {
    console.log(`  ${row.candidate.ats.padEnd(16)} ${row.candidate.slug.padEnd(28)} jobs=${String(row.verification.jobCount).padStart(4)} sample=${row.verification.sampleTitles[0] ?? "(none)"}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
