import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeFilters } from "@/lib/parse-query";
import { searchJobs } from "@/lib/exa";
import { rerankWithMetrics } from "@/lib/rerank";
import { cacheSearch, getCachedSearch } from "@/lib/cache";
import { log } from "@/lib/logger";
import { captureRouteError } from "@/lib/observe";
import { generateDigestEmailHtml } from "@/emails/DigestEmail";
import { Resend } from "resend";
import type { ExaResult, Filters } from "@/types/job";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
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

    // Avoid re-parsing entirely for cron digest runs — use the rich filters that were
    // captured + sanitized when the search was originally saved. This is a major cost win.
    // (parseQuery fast-path helps interactive, but here we skip LLM completely.)
    const processOne = async (savedSearch: (typeof savedSearches)[0], signal?: AbortSignal) => {
      try {
        const savedFilters = savedSearch.filters as Record<string, unknown>;
        const mergedFilters: Filters = sanitizeFilters(savedFilters);

        const cached = await getCachedSearch(savedSearch.rawQuery, mergedFilters);
        let exaResults: ExaResult[] = [];

        if (cached && cached.jobs.length > 0) {
          exaResults = cached.jobs;
        } else {
          exaResults = await searchJobs(savedSearch.rawQuery, mergedFilters, signal);
          try {
            const r = await rerankWithMetrics(savedSearch.rawQuery, exaResults, signal);
            const rerankScores = Object.fromEntries(
              r.items
                .map((item) => [exaResults[item.idx]?.id, { score: item.score, fit: item.fit }] as const)
                .filter(([id]) => typeof id === "string"),
            );
            await cacheSearch(savedSearch.rawQuery, mergedFilters, exaResults, rerankScores);
          } catch {
            // Fallback — still use exaResults for delta computation
          }
        }

        const previousRun = await prisma.savedSearchRun.findFirst({
          where: { savedSearchId: savedSearch.id },
          orderBy: { createdAt: "desc" },
        });

        // Fix: previous newJobIds now stores the FULL snapshot of seen jobs (from previous tick's current).
        // On first run, store full current as snapshot (delta 0, no email).
        // On later runs, compute delta vs previous FULL set, then store the new FULL current snapshot.
        const previousJobIds = new Set(previousRun?.newJobIds || []);
        const currentJobIds = exaResults.map((j) => j.id);
        const deltaJobIds = currentJobIds.filter((id) => !previousJobIds.has(id));
        const isFirstRun = !previousRun;

        if (isFirstRun) {
          await prisma.savedSearchRun.create({
            data: {
              savedSearchId: savedSearch.id,
              newJobIds: currentJobIds,  // store FULL snapshot
              deltaCount: 0,
            },
          });
        } else if (deltaJobIds.length > 0) {
          await prisma.savedSearchRun.create({
            data: {
              savedSearchId: savedSearch.id,
              newJobIds: currentJobIds,  // store FULL current snapshot for next diff
              deltaCount: deltaJobIds.length,
            },
          });
        }

        const now = new Date();
        // Use cadence boundary for cooldown, not just < now (which is always true)
        const cadenceBoundary = savedSearch.cadence === "daily" ? oneDayAgo : oneWeekAgo;
        const shouldAttemptEmail =
          !isFirstRun &&
          deltaJobIds.length > 0 &&
          (!savedSearch.lastNotifiedAt || savedSearch.lastNotifiedAt < cadenceBoundary);

        const emailTarget = savedSearch.notifyEmail || savedSearch.user?.email;
        const targetEmail = process.env.EMAIL_TEST_MODE === "true" ? process.env.ADMIN_EMAIL : emailTarget;

        if (shouldAttemptEmail && targetEmail && resend && process.env.RESEND_FROM) {
          let sendSuccess = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const newJobsDetails = exaResults
                .filter((j) => deltaJobIds.includes(j.id))
                .slice(0, 5)
                .map((j) => ({
                  title: j.title,
                  company: j.author || "Unknown Company",
                  url: j.url,
                }));

              const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://openrolekb.example.com";
              const searchUrl = `${siteUrl}/search?q=${encodeURIComponent(savedSearch.rawQuery)}`;

              await resend.emails.send({
                from: process.env.RESEND_FROM,
                to: targetEmail,
                subject: `New jobs matching "${savedSearch.rawQuery}"`,
                html: generateDigestEmailHtml(savedSearch.rawQuery, deltaJobIds.length, newJobsDetails, searchUrl),
              });

              sendSuccess = true;
              break;
            } catch (sendErr) {
              if (attempt === 0) {
                log.warn({ evt: "digest_email_retry", savedSearchId: savedSearch.id, attempt });
                await new Promise((r) => setTimeout(r, 800));
              } else {
                captureRouteError(sendErr, { route: "/api/cron/saved-search-run", savedSearchId: savedSearch.id, phase: "email" });
              }
            }
          }
          if (sendSuccess) {
            await prisma.savedSearch.update({ where: { id: savedSearch.id }, data: { lastNotifiedAt: now } });
            await prisma.eventLog.create({ data: { evt: "digest_email_sent", ownerKey: savedSearch.anonId || savedSearch.userId, resultCount: deltaJobIds.length, parseMs: 0, exaMs: 0, rerankMs: 0, totalMs: 0, rerankFailed: false } });
            log.info({ evt: "digest_email_sent", savedSearchId: savedSearch.id, targetEmail });
          }
          await prisma.savedSearch.update({ where: { id: savedSearch.id }, data: { lastRunAt: now } });
        } else {
          await prisma.savedSearch.update({ where: { id: savedSearch.id }, data: { lastRunAt: now } });
        }

        await prisma.eventLog.create({
          data: { evt: "saved_search_run_completed", ownerKey: savedSearch.anonId || savedSearch.userId, resultCount: deltaJobIds.length, parseMs: 0, exaMs: 0, rerankMs: 0, totalMs: 0, rerankFailed: false },
        });
        log.info({ evt: "saved_search_run_completed", savedSearchId: savedSearch.id, newJobCount: deltaJobIds.length, isFirstRun });
      } catch (err) {
        captureRouteError(err, { route: "/api/cron/saved-search-run", savedSearchId: savedSearch.id, phase: "run" });
      }
    };

    // Concurrency control for cron (p-limit style without extra dep).
    // Full AbortSignal threading: pass request.signal down to search/rerank (they support it).
    const CONCURRENCY = 5;
    for (let i = 0; i < savedSearches.length; i += CONCURRENCY) {
      const batch = savedSearches.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((s) => processOne(s, request.signal)));
    }

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    captureRouteError(err, { route: "/api/cron/saved-search-run", phase: "setup" });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
