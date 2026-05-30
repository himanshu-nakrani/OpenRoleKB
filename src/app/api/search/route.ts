import { NextRequest } from "next/server";
import { parseQuery } from "@/lib/parse-query";
import { searchJobs } from "@/lib/exa";
import { getCachedSearch, cacheSearch } from "@/lib/cache";
import { rerank } from "@/lib/rerank";
import { rateLimit } from "@/lib/rate-limit";
import type { RerankItem } from "@/types/job";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const allowed = rateLimit(request);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { query: string } | null = null;
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
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(sse(event, data)));
      }

      try {
        const { filters } = await parseQuery(rawQuery);
        send("parsed", filters);

        const cached = await getCachedSearch(rawQuery, filters);
        if (cached?.jobs?.length) {
          send("results", cached.jobs);
          const scores = (cached.cache.rerankScores as Record<string, { score: number; fit: string }>) || {};
          const reranked: RerankItem[] = cached.cache.resultJobIds
            .map((id, i) => ({
              idx: i,
              score: scores[id]?.score ?? 0.5,
              fit: scores[id]?.fit ?? "",
            }))
            .filter((r) => r.score >= 0.4);
          send("rerank", reranked);
          send("done", { id: cached.cache.id });
          controller.close();
          return;
        }

        const exaResults = await searchJobs(rawQuery, filters);
        send("results", exaResults);

        let reranked: RerankItem[] = [];
        let rerankScores: Record<string, { score: number; fit: string }> = {};
        try {
          reranked = await rerank(rawQuery, exaResults);
          rerankScores = Object.fromEntries(
            reranked.map((r) => [exaResults[r.idx]?.id, { score: r.score, fit: r.fit }]).filter(([, v]) => v),
          );
          reranked = reranked.filter((r) => r.score >= 0.4);
        } catch {
          reranked = exaResults.map((_, i) => ({ idx: i, score: 0.5, fit: "" }));
        }
        send("rerank", reranked);

        let cacheId: string | null = null;
        try {
          cacheId = await cacheSearch(rawQuery, filters, exaResults, rerankScores);
        } catch {
          // cache write failure is non-fatal
        }
        send("done", { id: cacheId });
      } catch (err) {
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
