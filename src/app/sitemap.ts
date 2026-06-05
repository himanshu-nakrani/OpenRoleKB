import { prisma } from "@/lib/prisma";
import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://openrolekb.example.com";

  const staticPages: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date() },
    { url: `${base}/about`, lastModified: new Date() },
    { url: `${base}/privacy`, lastModified: new Date() },
    { url: `${base}/terms`, lastModified: new Date() },
  ];

  // Include job permalinks for all cached jobs (P2)
  const jobs = await prisma.job.findMany({
    select: { id: true, lastSeenAt: true },
    orderBy: { lastSeenAt: "desc" },
    take: 1000, // cap for sitemap size
  });

  const jobPages: MetadataRoute.Sitemap = jobs.map((j) => ({
    url: `${base}/job/${j.id}`,
    lastModified: j.lastSeenAt,
  }));

  return [...staticPages, ...jobPages];
}
