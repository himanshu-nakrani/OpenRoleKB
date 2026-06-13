import { getLLM, getLLMModel, getLLMReasoningEffort } from "@/lib/llm";
import type { ExaResult, RerankItem } from "@/types/job";
import type OpenAI from "openai";
import { RERANK_TEXT_CHARS } from "@/lib/config";

const RERANK_RUBRIC = `You are a job search relevance rater. Score how well each job posting matches the user's query, considering ALL constraints (role, seniority, skills, location, remote, exclusions).

Score 0.0 to 1.0:
- 1.0: Perfect match — satisfies every constraint
- 0.8-0.9: Excellent match — hits most constraints
- 0.6-0.7: Good match — relevant role but missing some preferences
- 0.4-0.5: Partial match — tangentially related
- 0.0-0.3: Poor match — wrong role or explicitly excluded

SENIORITY IS A HARD CONSTRAINT, NOT A PREFERENCE:
- If the user asked for "junior" / "entry-level" / "associate" / "new grad" / "graduate", a posting titled Senior / Staff / Lead / Principal / Director / VP scores AT MOST 0.3 — it is the wrong role, not a partial match.
- Symmetric for "senior" / "staff" queries: a junior or associate posting scores AT MOST 0.3.
- "Mid-level" is the flexible band — neither junior nor senior titles qualify as a strong match.

For each result, provide a one-line explanation (max 80 chars). Return all results ordered by score descending.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "rate_results",
      description: "Return scored results",
      parameters: {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                idx: { type: "number" },
                score: { type: "number" },
                fit: { type: "string" },
              },
              required: ["idx", "score", "fit"],
            },
          },
        },
        required: ["results"],
      },
    },
  },
];

export type RerankResult = { items: RerankItem[]; tokens?: number };

const RERANK_BATCH_SIZE = 15;
const RERANK_FIT_CHARS = 80;

export async function rerank(
  rawQuery: string,
  results: ExaResult[],
  signal?: AbortSignal,
): Promise<RerankItem[]> {
  const { items } = await rerankWithMetrics(rawQuery, results, signal);
  return items;
}

export async function rerankWithMetrics(
  rawQuery: string,
  results: ExaResult[],
  signal?: AbortSignal,
): Promise<RerankResult> {
  if (results.length === 0) return { items: [] };
  if (results.length === 1) {
    return { items: [{ idx: 0, score: 1.0, fit: "Only result available" }] };
  }

  const batches = Array.from(
    { length: Math.ceil(results.length / RERANK_BATCH_SIZE) },
    (_, batchIndex) => {
      const start = batchIndex * RERANK_BATCH_SIZE;
      return results.slice(start, start + RERANK_BATCH_SIZE).map((result, offset) => ({
        result,
        idx: start + offset,
      }));
    },
  );

  const scored = await Promise.all(
    batches.map((batch) => scoreBatch(rawQuery, results.length, batch, signal)),
  );

  const tokens = scored.reduce<number | undefined>((sum, batch) => {
    if (batch.tokens === undefined) return sum;
    return (sum ?? 0) + batch.tokens;
  }, undefined);

  const items = scored
    .flatMap((batch) => batch.items)
    .sort((a, b) => b.score - a.score);

  return { items, tokens };
}

async function scoreBatch(
  rawQuery: string,
  totalResults: number,
  batch: Array<{ result: ExaResult; idx: number }>,
  signal?: AbortSignal,
): Promise<RerankResult> {
  const llm = getLLM();

  const resultsList = batch
    .map(({ result: r, idx }) => `${idx}. ${r.title}\n   URL: ${r.url}\n   ${r.text.substring(0, RERANK_TEXT_CHARS)}`)
    .join("\n\n");

  const response = await llm.chat.completions.create(
    {
      model: getLLMModel(),
      max_tokens: 2000,
      temperature: 0,
      reasoning_effort: getLLMReasoningEffort(),
      messages: [
        { role: "system", content: RERANK_RUBRIC },
        { role: "user", content: `User query: "${rawQuery}"\n\nRate these job postings:\n\n${resultsList}` },
      ],
      tools: TOOLS,
      tool_choice: { type: "function", function: { name: "rate_results" } },
    },
    { signal },
  );

  const tokens = response.usage?.total_tokens;
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (toolCall?.type === "function" && toolCall.function.name === "rate_results") {
    const rated = JSON.parse(toolCall.function.arguments) as { results: RerankItem[] };

    const valid = rated.results
      .filter((r) => Number.isInteger(r.idx) && r.idx >= 0 && r.idx < totalResults)
      .map((r) => ({
        idx: r.idx,
        score: typeof r.score === "number" && r.score >= 0 && r.score <= 1 ? r.score : 0.5,
        fit: typeof r.fit === "string" ? r.fit.slice(0, RERANK_FIT_CHARS) : "",
      }));

    return { items: valid, tokens };
  }

  return {
    items: batch.map(({ idx }) => ({ idx, score: 0.5, fit: "Relevance not rated" })),
    tokens,
  };
}
