import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseQuery, sanitizeFilters } from "@/lib/parse-query";
import { searchJobs } from "@/lib/exa";
import { rerankWithMetrics } from "@/lib/rerank";
import { cacheSearch, getCachedSearch } from "@/lib/cache";
import { log } from "@/lib/logger";
import { captureRouteError } from "@/lib/observe";
import { generateDigestEmailHtml } from "@/emails/DigestEmail";
import { Resend } from "resend";
import type { ExaResult, Filters } from "@/types/job";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const savedSearches = await prisma.savedSearch.findMany({
      where: {
        cadence: { not: "off" },
        OR: [
          { cadence: "daily", lastRunAt: { lt: oneDayAgo } },
          { cadence: "weekly", lastRunAt: { lt: oneWeekAgo } },
          { lastRunAt: null },
        ],
      },
      include: {
        user: { select: { email: true } },
      },
    });

    for (const savedSearch of savedSearches) {
      try {
        const savedFilters = savedSearch.filters as Record<string, unknown>;
        const parsed = await parseQuery(savedSearch.rawQuery);
        const mergedFilters: Filters = { ...parsed.filters, ...sanitizeFilters(savedFilters) };

        const cached = await getCachedSearch(savedSearch.rawQuery, mergedFilters);
        let exaResults: ExaResult[] = [];
        
        if (cached?.jobs?.length) {
          exaResults = cached.jobs;
        } else {
          exaResults = await searchJobs(savedSearch.rawQuery, mergedFilters);
          try {
            const r = await rerankWithMetrics(savedSearch.rawQuery, exaResults);
            const rerankScores = Object.fromEntries(
              r.items
                .map((item) => [exaResults[item.idx]?.id, { score: item.score, fit: item.fit }] as const)
                .filter(([id]) => typeof id === "string"),
            );
            await cacheSearch(savedSearch.rawQuery, mergedFilters, exaResults, rerankScores);
          } catch {
            // Fallback
          }
        }

        const previousRun = await prisma.savedSearchRun.findFirst({
          where: { savedSearchId: savedSearch.id },
          orderBy: { createdAt: "desc" },
        });

        const previousJobIds = new Set(previousRun?.newJobIds || []);
        const currentJobIds = exaResults.map((j) => j.id);
        const newJobIds = currentJobIds.filter((id) => !previousJobIds.has(id));

        if (newJobIds.length > 0) {
          await prisma.savedSearchRun.create({
            data: {
              savedSearchId: savedSearch.id,
              newJobIds,
              deltaCount: newJobIds.length,
            },
          });
        }

        await prisma.savedSearch.update({
          where: { id: savedSearch.id },
          data: { lastRunAt: now },
        });

        // Send email if there are new jobs and we haven't already notified for this run.
        // `now` is the run's effective lastRunAt (set above); comparing against it
        // means a missed/failed digest in a previous tick will be retried.
        if (newJobIds.length > 0 && (!savedSearch.lastNotifiedAt || savedSearch.lastNotifiedAt < now)) {
          const emailTarget = savedSearch.notifyEmail || savedSearch.user?.email;
          const targetEmail = process.env.EMAIL_TEST_MODE === "true" ? process.env.ADMIN_EMAIL : emailTarget;

          if (targetEmail && resend) {
            const newJobsDetails = exaResults
              .filter((j) => newJobIds.includes(j.id))
              .slice(0, 5)
              .map((j) => ({
                title: j.title,
                company: j.author || "Unknown Company",
                url: j.url,
              }));

            const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://openrolekb.example.com";
            const searchUrl = `${siteUrl}/search?q=${encodeURIComponent(savedSearch.rawQuery)}`;

            await resend.emails.send({
              from: "OpenRoleKB <digest@openrolekb.example.com>",
              to: targetEmail,
              subject: `New jobs matching "${savedSearch.rawQuery}"`,
              html: generateDigestEmailHtml(savedSearch.rawQuery, newJobIds.length, newJobsDetails, searchUrl),
            });

            await prisma.savedSearch.update({
              where: { id: savedSearch.id },
              data: { lastNotifiedAt: now },
            });

            await prisma.eventLog.create({
              data: {
                evt: "digest_email_sent",
                ownerKey: savedSearch.anonId || savedSearch.userId,
                resultCount: newJobIds.length,
                parseMs: 0,
                exaMs: 0,
                rerankMs: 0,
                totalMs: 0,
                rerankFailed: false,
              },
            });

            log.info({
              evt: "digest_email_sent",
              savedSearchId: savedSearch.id,
              targetEmail,
            });
          }
        }

        await prisma.eventLog.create({
          data: {
            evt: "saved_search_run_completed",
            ownerKey: savedSearch.anonId || savedSearch.userId,
            resultCount: newJobIds.length,
            parseMs: 0,
            exaMs: 0,
            rerankMs: 0,
            totalMs: 0,
            rerankFailed: false,
          },
        });

        log.info({
          evt: "saved_search_run_completed",
          savedSearchId: savedSearch.id,
          newJobCount: newJobIds.length,
        });
      } catch (err) {
        captureRouteError(err, { route: "/api/cron/saved-search-run", savedSearchId: savedSearch.id, phase: "run" });
      }
    }

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    captureRouteError(err, { route: "/api/cron/saved-search-run", phase: "setup" });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
