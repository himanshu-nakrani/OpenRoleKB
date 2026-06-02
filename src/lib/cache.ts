import { prisma } from "@/lib/prisma";
import { hashQuery } from "@/lib/hash";
import { extractCompany } from "@/lib/company";
import { extractLocation } from "@/lib/location";
import type { Filters, ExaResult } from "@/types/job";
import type { Prisma } from "../../generated/prisma/client";

const CACHE_TTL_HOURS = 6;

type CachedJob = {
  id: string;
  title: string;
  url: string;
  text: string;
  highlights: string[];
  publishedDate?: string;
  author?: string;
  lastSeenAt?: string;
};

function adaptToExaShape(j: {
  id: string;
  title: string;
  url: string;
  description: string | null;
  publishedAt: Date | null;
  lastSeenAt: Date;
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
  };
}

export async function getCachedSearch(rawQuery: string, filters: Filters) {
  const queryHash = hashQuery(rawQuery, filters);
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);

  const cached = await prisma.searchCache.findUnique({
    where: { queryHash },
  });

  if (!cached || cached.createdAt < cutoff) return null;

  const jobs = await prisma.job.findMany({
    where: { id: { in: cached.resultJobIds } },
  });

  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  const ordered = cached.resultJobIds
    .map((id) => jobMap.get(id))
    .filter((j): j is NonNullable<typeof j> => Boolean(j));

  return {
    cache: cached,
    jobs: ordered.map(adaptToExaShape),
    resultJobIds: ordered.map((j) => j.id),
  };
}

export async function cacheSearch(
  rawQuery: string,
  filters: Filters,
  results: ExaResult[],
  rerankScores: Record<string, { score: number; fit: string }>,
): Promise<string> {
  const queryHash = hashQuery(rawQuery, filters);

  const jobPromises = results.map(async (r) => {
    const { location, isRemote } = r.text ? extractLocation(r.text) : { location: null, isRemote: false };
    return prisma.job.upsert({
      where: { url: r.url },
      create: {
        url: r.url,
        title: r.title,
        company: extractCompany(r.url),
        location,
        isRemote,
        description: r.text,
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
        source: new URL(r.url).hostname,
      },
      update: {
        title: r.title,
        company: extractCompany(r.url),
        description: r.text,
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
      },
    });
  });

  const upsertedJobs = await Promise.all(jobPromises);
  const jobIds = upsertedJobs.map((j) => j.id);

  const cache = await prisma.searchCache.upsert({
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
}
