import { prisma } from "@/lib/prisma";
import { hashQuery } from "@/lib/hash";
import { extractCompany } from "@/lib/company";
import type { Filters, ExaResult } from "@/types/job";
import type { Prisma } from "../../generated/prisma/client";

const CACHE_TTL_HOURS = 6;

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

  return {
    cache: cached,
    jobs: cached.resultJobIds.map((id) => jobMap.get(id)).filter(Boolean),
  };
}

export async function cacheSearch(
  rawQuery: string,
  filters: Filters,
  results: ExaResult[],
  rerankScores: Record<string, { score: number; fit: string }>,
): Promise<string> {
  const queryHash = hashQuery(rawQuery, filters);
  const jobIds: string[] = [];

  for (const r of results) {
    const job = await prisma.job.upsert({
      where: { url: r.url },
      create: {
        url: r.url,
        title: r.title,
        company: extractCompany(r.url),
        location: null,
        description: r.text,
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
        source: new URL(r.url).hostname,
      },
      update: {
        title: r.title,
        company: extractCompany(r.url),
        description: r.text,
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
        lastSeenAt: new Date(),
      },
    });
    jobIds.push(job.id);
  }

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
