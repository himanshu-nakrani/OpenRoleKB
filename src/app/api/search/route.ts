import { NextRequest } from "next/server";
import { parseQuery, sanitizeFilters } from "@/lib/parse-query";
import { searchJobs } from "@/lib/exa";
import { getCachedSearch, cacheSearch } from "@/lib/cache";
import { rerankWithMetrics } from "@/lib/rerank";
import { rateLimit } from "@/lib/rate-limit";
import { getOwnerKey } from "@/lib/owner";
import { extractCompany } from "@/lib/company";
import { extractSalary } from "@/lib/salary";
import { captureRouteError } from "@/lib/observe";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  MAX_QUERY_LENGTH,
  MIN_RERANK_SCORE,
  EXA_USD_PER_REQUEST,
  GEMINI_USD_PER_1K_TOKENS,
} from "@/lib/config";
import type { RerankItem, Filters } from "@/types/job";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function applyHiddenCompanies(
  ownerKey: string | null,
  reranked: RerankItem[],
  results: Array<{ url: string }>,
  preloadedHidden?: Array<{ company: string }>,
): Promise<RerankItem[]> {
  if (!ownerKey) return reranked;
  const hidden = preloadedHidden ?? (await prisma.hiddenCompany.findMany({
    where: { ownerKey },
    select: { company: true },
  }));
  if (!hidden.length) return reranked;
  const hiddenSet = new Set(hidden.map((h) => h.company.toLowerCase()));
  return reranked.filter((r) => {
    const company = extractCompany(results[r.idx]?.url ?? "")?.toLowerCase();
    return !company || !hiddenSet.has(company);
  });
}

export async function POST(request: NextRequest) {
  const t0 = performance.now();
  const ownerKey = await getOwnerKey(request);
  const { ok } = await rateLimit(request, ownerKey ?? undefined);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { query: string; filters?: Filters } | null = null;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body?.query || typeof body.query !== "string" || !body.query.trim()) {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawQuery = body.query.trim();
  const filtersOverride = body.filters;

  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return new Response(JSON.stringify({ error: "query too long" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(sse(event, data)));
      }

      let parseMs = 0;
      let exaMs = 0;
      let rerankMs = 0;
      let cacheHit = false;
      let cacheMs = 0;
      let resultCount = 0;
      let rerankFailed = false;
      let parseTokens: number | undefined;
      let rerankTokens: number | undefined;
      let exaCostUsd: number | undefined;
      let llmCostUsd: number | undefined;

      try {
        // Start hidden companies fetch early so the small DB query runs in parallel
        // with the expensive parse/Exa/rerank or cache lookup (low-hanging latency win).
        const hiddenPromise = ownerKey
          ? prisma.hiddenCompany.findMany({ where: { ownerKey }, select: { company: true } }).catch(() => [])
          : Promise.resolve([]);

        let filters: Filters;
        if (filtersOverride) {
          filters = sanitizeFilters(filtersOverride);
          parseMs = 0;
        } else {
          const tParse = performance.now();
          const parsed = await parseQuery(rawQuery, request.signal);
          parseMs = Math.round(performance.now() - tParse);
          filters = parsed.filters;
          parseTokens = parsed.tokens;
          if (parsed.parseError) {
            captureRouteError(new Error(parsed.parseError), { route: "/api/search", ownerKey, phase: "parse" });
          }
        }
        send("parsed", filters);

        const tCacheCheck = performance.now();
        const cached = await getCachedSearch(rawQuery, filters);
        cacheMs = Math.round(performance.now() - tCacheCheck);

        if (cached && cached.jobs.length > 0) {
          cacheHit = true;
          send("results", cached.jobs);

          const scores = (cached.cache.rerankScores as Record<string, { score: number; fit: string }>) || {};
          let reranked: RerankItem[] = cached.resultJobIds
            .map((id, i) => ({
              idx: i,
              score: scores[id]?.score ?? 0.5,
              fit: scores[id]?.fit ?? "",
            }))
            .filter((r) => r.score >= MIN_RERANK_SCORE);

          const hiddenForCache = await hiddenPromise;
          reranked = await applyHiddenCompanies(ownerKey, reranked, cached.jobs, hiddenForCache);

          resultCount = reranked.length;
          send("rerank", reranked);
          send("done", { id: cached.cache.id });

          const totalMs = Math.round(performance.now() - t0);
          try {
            await logMetrics({ ownerKey, cacheHit, resultCount, parseMs, exaMs: 0, rerankMs: 0, cacheMs, totalMs, rerankFailed, parseTokens, rerankTokens, exaCostUsd, llmCostUsd });
          } catch (err) {
            captureRouteError(err, { route: "/api/search", ownerKey, phase: "cache" });
          }
          return;
        }

        const tExa = performance.now();
        let exaResults = await searchJobs(rawQuery, filters, request.signal);
        exaMs = Math.round(performance.now() - tExa);
        // Exa charges per 1k requests; 50 results in this app is a single request.
        exaCostUsd = EXA_USD_PER_REQUEST;
        // Attach salary extraction for fresh results (P2)
        exaResults = exaResults.map((r) => {
          const sal = r.text ? extractSalary(r.text) : {};
          return { ...r, salaryMinUsd: sal.min, salaryMaxUsd: sal.max, salaryRaw: sal.raw };
        });
        send("results", exaResults);

        let reranked: RerankItem[] = [];
        let rerankScores: Record<string, { score: number; fit: string }> = {};
        try {
          const tRerank = performance.now();
          const r = await rerankWithMetrics(rawQuery, exaResults, request.signal);
          rerankMs = Math.round(performance.now() - tRerank);
          reranked = r.items;
          rerankTokens = r.tokens;
          rerankScores = Object.fromEntries(
            reranked
              .map((r) => [exaResults[r.idx]?.id, { score: r.score, fit: r.fit }] as const)
              .filter(([id]) => typeof id === "string"),
          );
          reranked = reranked.filter((r) => r.score >= MIN_RERANK_SCORE);
        } catch (err) {
          rerankFailed = true;
          captureRouteError(err, { route: "/api/search", ownerKey, phase: "rerank" });
          reranked = exaResults.map((_, i) => ({ idx: i, score: 0.5, fit: "" }));
        }

        llmCostUsd = estimateLlmCostUsd(parseTokens, rerankTokens);

        const hiddenForExa = await hiddenPromise;
        reranked = await applyHiddenCompanies(ownerKey, reranked, exaResults, hiddenForExa);

        resultCount = reranked.length;
        send("rerank", reranked);

        let cacheId: string | null = null;
        if (!rerankFailed) {
          try {
            cacheId = await cacheSearch(rawQuery, filters, exaResults, rerankScores);
          } catch (err) {
            captureRouteError(err, { route: "/api/search", ownerKey, phase: "cache" });
          }
        }
        send("done", { id: cacheId });

        const totalMs = Math.round(performance.now() - t0);
        try {
          await logMetrics({ ownerKey, cacheHit, resultCount, parseMs, exaMs, rerankMs, cacheMs: 0, totalMs, rerankFailed, parseTokens, rerankTokens, exaCostUsd, llmCostUsd });
        } catch (err) {
          captureRouteError(err, { route: "/api/search", ownerKey, phase: "cache" });
        }
      } catch (err) {
        captureRouteError(err, { route: "/api/search", ownerKey, phase: "exa" });
        send("error", { message: err instanceof Error ? err.message : "Search failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Cost constants are now centralized in @/lib/config (single source of truth for
// pricing, thresholds, and limits). Re-exported here for backward compat in tests
// if needed; new code should import directly from config.
export { EXA_USD_PER_REQUEST, GEMINI_USD_PER_1K_TOKENS } from "@/lib/config";

export function estimateLlmCostUsd(parseTokens?: number, rerankTokens?: number): number | undefined {
  const total = (parseTokens ?? 0) + (rerankTokens ?? 0);
  if (total === 0) return undefined;
  return Math.round((total / 1000) * GEMINI_USD_PER_1K_TOKENS * 1e6) / 1e6;
}

async function logMetrics(metrics: {
  ownerKey: string | null;
  cacheHit: boolean;
  resultCount: number;
  parseMs: number;
  exaMs: number;
  rerankMs: number;
  cacheMs: number;
  totalMs: number;
  rerankFailed: boolean;
  parseTokens?: number;
  rerankTokens?: number;
  exaCostUsd?: number;
  llmCostUsd?: number;
}) {
  log.info({ evt: "search", route: "/api/search", dur_ms: metrics.totalMs, ...metrics });
  await prisma.eventLog.create({
    data: {
      evt: "search",
      ownerKey: metrics.ownerKey,
      cacheHit: metrics.cacheHit,
      resultCount: metrics.resultCount,
      parseMs: metrics.parseMs,
      exaMs: metrics.exaMs,
      rerankMs: metrics.rerankMs,
      cacheMs: metrics.cacheMs,
      totalMs: metrics.totalMs,
      rerankFailed: metrics.rerankFailed,
      parseTokens: metrics.parseTokens,
      rerankTokens: metrics.rerankTokens,
      exaCostUsd: metrics.exaCostUsd,
      llmCostUsd: metrics.llmCostUsd,
    },
  });
}
