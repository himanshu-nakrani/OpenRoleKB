import { prisma } from "@/lib/prisma";
import { hashQuery } from "@/lib/hash";
import { createHash } from "crypto";
import { extractCompany } from "@/lib/company";
import { extractLocation, normalizeLocation } from "@/lib/location";
import { extractSalary } from "@/lib/salary";
import type { Filters, ExaResult } from "@/types/job";
import type { Prisma } from "../../generated/prisma/client";
import { CACHE_TTL_HOURS } from "@/lib/config";

// Simple per-instance L1 cache for very hot recent searches (avoids DB roundtrip on repeats within ~1min).
// Complements the 6h Postgres cache. Automatically ages out.
type L1Entry = { value: unknown; ts: number };
const l1Cache = new Map<string, L1Entry>();
const L1_TTL_MS = 60 * 1000; // 1 minute
function getFromL1(key: string): unknown {
  const entry = l1Cache.get(key);
  if (entry && Date.now() - entry.ts < L1_TTL_MS) return entry.value;
  if (entry) l1Cache.delete(key);
  return null;
}
function setL1(key: string, value: unknown) {
  l1Cache.set(key, { value, ts: Date.now() });
  // Opportunistic prune
  if (l1Cache.size > 2000) {
    const cutoff = Date.now() - L1_TTL_MS;
    for (const [k, v] of l1Cache) {
      if (v.ts < cutoff) l1Cache.delete(k);
    }
  }
}

type CachedJob = {
  id: string;
  title: string;
  url: string;
  text: string;
  highlights: string[];
  publishedDate?: string;
  author?: string;
  lastSeenAt?: string;
  salaryMinUsd?: number;
  salaryMaxUsd?: number;
  salaryRaw?: string;
};

function adaptToExaShape(j: {
  id: string;
  title: string;
  url: string;
  description: string | null;
  publishedAt: Date | null;
  lastSeenAt: Date;
  salaryMinUsd?: number | null;
  salaryMaxUsd?: number | null;
  salaryRaw?: string | null;
}): CachedJob {
  return {
    id: j.id,
    title: j.title,
    url: j.url,
    text: j.description ?? "",
    highlights: [],
    publishedDate: j.publishedAt?.toISOString(),
    author: undefined,
    lastSeenAt: j.lastSeenAt.toISOString(),
    salaryMinUsd: j.salaryMinUsd ?? undefined,
    salaryMaxUsd: j.salaryMaxUsd ?? undefined,
    salaryRaw: j.salaryRaw ?? undefined,
  };
}

export async function getCachedSearch(rawQuery: string, filters: Filters) {
  const queryHash = hashQuery(rawQuery, filters);

  // L1 first (very hot repeat queries within the same serverless instance)
  const l1Hit = getFromL1(queryHash);
  if (l1Hit) return l1Hit;

  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);

  // DB-side TTL filter using findFirst (pushes expiration check to Postgres)
  const cached = await prisma.searchCache.findFirst({
    where: {
      queryHash,
      createdAt: { gte: cutoff },
    },
  });

  if (!cached) return null;

  const jobs = await prisma.job.findMany({
    where: { id: { in: cached.resultJobIds } },
  });

  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  const ordered = cached.resultJobIds
    .map((id) => jobMap.get(id))
    .filter((j): j is NonNullable<typeof j> => Boolean(j));

  const result = {
    cache: cached,
    jobs: ordered.map(adaptToExaShape),
    resultJobIds: ordered.map((j) => j.id),
  };

  setL1(queryHash, result);
  return result;
}

export async function cacheSearch(
  rawQuery: string,
  filters: Filters,
  results: ExaResult[],
  rerankScores: Record<string, { score: number; fit: string }>,
): Promise<string> {
  const queryHash = hashQuery(rawQuery, filters);

  return prisma.$transaction(async (tx) => {
    const jobPromises = results.map(async (r) => {
      const { location: rawLoc, isRemote } = r.text ? extractLocation(r.text) : { location: null, isRemote: false };
      const location = normalizeLocation(rawLoc);
      const company = extractCompany(r.url);
      const salary = r.text ? extractSalary(r.text) : {};
      const dedupKey = createHash("sha256")
        .update(`${(r.title || "").toLowerCase().trim()}|${(company || "").toLowerCase()}|${(location || "").toLowerCase()}`)
        .digest("hex");
      return tx.job.upsert({
        where: { url: r.url },
        create: {
          url: r.url,
          title: r.title,
          company,
          location,
          locationRaw: rawLoc,
          isRemote,
          description: r.text,
          publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
          source: new URL(r.url).hostname,
          salaryMinUsd: salary.min,
          salaryMaxUsd: salary.max,
          salaryRaw: salary.raw,
          dedupKey,
        },
        update: {
          title: r.title,
          company,
          description: r.text,
          publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
          salaryMinUsd: salary.min ?? undefined,
          salaryMaxUsd: salary.max ?? undefined,
          salaryRaw: salary.raw,
          dedupKey,
        },
      });
    });

    const upsertedJobs = await Promise.all(jobPromises);
    const jobIds = upsertedJobs.map((j) => j.id);

    const cache = await tx.searchCache.upsert({
      where: { queryHash },
      create: {
        queryHash,
        rawQuery,
        filters: filters as Prisma.InputJsonValue,
        resultJobIds: jobIds,
        rerankScores: rerankScores as Prisma.InputJsonValue,
      },
      update: {
        rawQuery,
        filters: filters as Prisma.InputJsonValue,
        resultJobIds: jobIds,
        rerankScores: rerankScores as Prisma.InputJsonValue,
        createdAt: new Date(),
      },
      select: { id: true },
    });

    return cache.id;
  });
}
