import { NextRequest } from "next/server";
import { parseQuery, sanitizeFilters } from "@/lib/parse-query";
import { searchJobsWithReport } from "@/lib/exa";
import { searchLocalJobs } from "@/lib/local-search";
import { getCachedSearch, getCachedSearchByRawQuery, cacheSearch } from "@/lib/cache";
import { rerankWithMetrics } from "@/lib/rerank";
import { rateLimit } from "@/lib/rate-limit";
import { getOwnerKey } from "@/lib/owner";
import { extractCompany } from "@/lib/company";
import { extractSalary } from "@/lib/salary";
import { extractLocation } from "@/lib/location";
import { captureRouteError } from "@/lib/observe";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { stripLocalePrefix } from "@/lib/retrieval-quality";
import {
  MAX_QUERY_LENGTH,
  MIN_RERANK_SCORE,
  EXA_USD_PER_REQUEST,
  GEMINI_USD_PER_1K_TOKENS,
  LAYER_A_FALLBACK_THRESHOLD,
  LOCAL_SEARCH_MAX_RESULTS,
} from "@/lib/config";
import type { RerankItem, Filters, ExaResult } from "@/types/job";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}


function stripUrlNoise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    // Normalize locale prefix so /de/about-us/x and /about-us/x collapse to
    // the same dedup key. This catches ATS pages mirrored under locale subpaths.
    parsed.pathname = stripLocalePrefix(parsed.pathname);
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.split(/[?#]/, 1)[0].replace(/\/$/, "").toLowerCase();
  }
}

function normalizeContentPart(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function contentDedupKey(result: ExaResult): string {
  const company = result.company ?? result.author ?? extractCompany(result.url) ?? "";
  const location = result.location ?? (result.text ? extractLocation(result.text).location ?? "" : "");
  return [
    normalizeContentPart(company),
    normalizeContentPart(result.title),
    normalizeContentPart(location),
  ].join("|");
}

export function dedupeSearchResults(results: ExaResult[]): ExaResult[] {
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const deduped: ExaResult[] = [];

  for (const result of results) {
    const urlKey = stripUrlNoise(result.url);
    const contentKey = contentDedupKey(result);
    if (seenUrls.has(urlKey) || (contentKey !== "||" && seenContent.has(contentKey))) {
      continue;
    }
    seenUrls.add(urlKey);
    if (contentKey !== "||") seenContent.add(contentKey);
    deduped.push(result);
  }

  return deduped;
}

// Title tokens that contradict a stated seniority. The rerank rubric already
// instructs Gemini to floor these at 0.3, but the rubric isn't always honored —
// this is a deterministic backstop. Tokens match against a normalized title
// (punctuation stripped, single-spaced, padded with leading/trailing spaces).
const SENIOR_TITLE_TOKENS = ["principal", "staff", "lead", "director", "vp ", "vice president", "head of", "senior", " sr "];
const JUNIOR_TITLE_TOKENS = ["junior", "associate", "intern", "entry level", "new grad", "graduate", " i ", " 1 "];

function normalizeTitleForMatch(title: string): string {
  return ` ${title.toLowerCase().replace(/[.,/()&;:!?'"]/g, " ").replace(/\s+/g, " ").trim()} `;
}

export function titleContradictsSeniority(title: string, want: string): boolean {
  const t = normalizeTitleForMatch(title);
  const w = want.toLowerCase().trim();
  if (w === "junior" || w === "intern" || w === "entry" || w === "entry-level" || w === "associate") {
    return SENIOR_TITLE_TOKENS.some((tok) => t.includes(tok));
  }
  if (w === "senior" || w === "staff" || w === "principal" || w === "lead" || w === "director" || w === "vp" || w === "c-suite") {
    return JUNIOR_TITLE_TOKENS.some((tok) => t.includes(tok));
  }
  return false;
}

function applySeniorityFilter(
  reranked: RerankItem[],
  results: Array<{ title?: string }>,
  filters: Filters,
): RerankItem[] {
  if (!filters.seniority) return reranked;
  return reranked.filter((r) => {
    const title = results[r.idx]?.title ?? "";
    return !titleContradictsSeniority(title, filters.seniority!);
  });
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

        // Raw-query cache fast path: an exact repeat query can be served
        // without waiting ~2s for the LLM parse. The stored row carries the
        // filters from the original parse, which we replay as the parsed event.
        let filters: Filters | null = null;
        let cached: Awaited<ReturnType<typeof getCachedSearch>> = null;

        if (!filtersOverride) {
          const tRawCache = performance.now();
          cached = await getCachedSearchByRawQuery(rawQuery);
          cacheMs = Math.round(performance.now() - tRawCache);
          if (cached) {
            filters = sanitizeFilters(cached.cache.filters);
            parseMs = 0;
          }
        }

        if (!filters) {
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
        }
        send("parsed", filters);

        if (!cached) {
          const tCacheCheck = performance.now();
          cached = await getCachedSearch(rawQuery, filters);
          cacheMs += Math.round(performance.now() - tCacheCheck);
        }

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
          reranked = applySeniorityFilter(reranked, cached.jobs, filters);

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

        // Layer A: query the local Job corpus (ATS-ingested rows) first.
        const tLocal = performance.now();
        const local = await searchLocalJobs(filters, LOCAL_SEARCH_MAX_RESULTS);
        const localMs = Math.round(performance.now() - tLocal);
        log.info({
          evt: "local_search",
          route: "/api/search",
          tsquery: local.tsquery,
          raw_hits: local.rawHits,
          kept: local.results.length,
          ms: localMs,
        });

        const localResults = dedupeSearchResults(local.results);
        const willFallback = localResults.length < LAYER_A_FALLBACK_THRESHOLD;

        // Stream the local results immediately so the user sees something
        // in <200ms instead of waiting for Exa. The reranker pass below
        // operates on the same array, then we emit the rerank event.
        if (localResults.length > 0) {
          send("results", localResults);
        }

        // Inner helper: rerank a candidate array, hide companies, and
        // build the persisted score map. Mutates rerankMs/rerankTokens/
        // rerankFailed in the enclosing scope.
        async function rerankAndFilter(
          candidates: ExaResult[],
        ): Promise<{ reranked: RerankItem[]; scores: Record<string, { score: number; fit: string }> }> {
          try {
            const tRerank = performance.now();
            const r = await rerankWithMetrics(rawQuery, candidates, request.signal);
            rerankMs += Math.round(performance.now() - tRerank);
            rerankTokens = (rerankTokens ?? 0) + (r.tokens ?? 0);
            let items = r.items;
            const scores = Object.fromEntries(
              items
                .map((it) => [candidates[it.idx]?.id, { score: it.score, fit: it.fit }] as const)
                .filter(([id]) => typeof id === "string"),
            );
            items = items.filter((it) => it.score >= MIN_RERANK_SCORE);
            const hidden = await hiddenPromise;
            items = await applyHiddenCompanies(ownerKey, items, candidates, hidden);
            items = applySeniorityFilter(items, candidates, filters!);
            return { reranked: items, scores };
          } catch (err) {
            rerankFailed = true;
            captureRouteError(err, { route: "/api/search", ownerKey, phase: "rerank" });
            const fallback = candidates.map((_, i) => ({ idx: i, score: 0.5, fit: "" }));
            return { reranked: fallback, scores: {} };
          }
        }

        // First-pass rerank: run on whatever local has. Skip entirely if
        // we have nothing AND we know Exa is coming (avoids an LLM call
        // on an empty array).
        let combinedResults: ExaResult[] = localResults;
        let combinedRerank: RerankItem[] = [];
        let combinedScores: Record<string, { score: number; fit: string }> = {};

        if (localResults.length > 0) {
          const r1 = await rerankAndFilter(localResults);
          combinedRerank = r1.reranked;
          combinedScores = r1.scores;
          send("rerank", combinedRerank);
        }

        // Layer B: if local is under the threshold, call Exa as a discovery
        // / fallback pass. Merge with locals (dedupe by URL) and rerank
        // the combined set so the client gets a single coherent ordering.
        if (willFallback) {
          const tExa = performance.now();
          const exaResp = await searchJobsWithReport(rawQuery, filters, request.signal);
          let exaResults = exaResp.results;
          exaMs = Math.round(performance.now() - tExa);
          exaCostUsd = EXA_USD_PER_REQUEST;
          log.info({
            evt: "retrieval_quality",
            route: "/api/search",
            kept: exaResp.quality.kept,
            rejected_denylist: exaResp.quality.denylist_path,
            rejected_title: exaResp.quality.denylist_title,
            ats_listing_not_individual: exaResp.quality.ats_url_not_individual_job,
          });

          // Salary backfill for Exa results (P2; locals already have it from ingest)
          exaResults = exaResults.map((r) => {
            const sal = r.text ? extractSalary(r.text) : {};
            return { ...r, salaryMinUsd: sal.min, salaryMaxUsd: sal.max, salaryRaw: sal.raw };
          });

          // Dedupe by normalized URL and content key. Locals are first, so
          // Layer A wins over Layer B when both discover the same posting.
          const mergedResults = dedupeSearchResults([...localResults, ...exaResults]);
          const newExaResults = mergedResults.slice(localResults.length);

          if (newExaResults.length > 0) {
            combinedResults = mergedResults;
            send("results", combinedResults);

            // Second pass scores ONLY the new Exa items — locals keep their
            // first-pass scores (same query, same model: re-scoring them is
            // pure latency). Exa idx values are offset into the merged array,
            // where locals occupy [0, localResults.length).
            const r2 = await rerankAndFilter(newExaResults);
            const offsetExaRerank = r2.reranked.map((it) => ({ ...it, idx: it.idx + localResults.length }));
            combinedRerank = [...combinedRerank, ...offsetExaRerank].sort((a, b) => b.score - a.score);
            combinedScores = { ...combinedScores, ...r2.scores };
            send("rerank", combinedRerank);
          }
        }

        llmCostUsd = estimateLlmCostUsd(parseTokens, rerankTokens);
        resultCount = combinedRerank.length;

        let cacheId: string | null = null;
        if (!rerankFailed) {
          try {
            cacheId = await cacheSearch(rawQuery, filters, combinedResults, combinedScores);
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
