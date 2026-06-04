import { getLLM } from "@/lib/llm";
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

  const llm = getLLM();

  const resultsList = results
    .map((r, i) => `${i}. ${r.title}\n   URL: ${r.url}\n   ${r.text.substring(0, RERANK_TEXT_CHARS)}`)
    .join("\n\n");

  const response = await llm.chat.completions.create(
    {
      model: "deepseek-chat",
      max_tokens: 2000,
      temperature: 0,
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
      .filter((r) => Number.isInteger(r.idx) && r.idx >= 0 && r.idx < results.length)
      .map((r) => ({
        idx: r.idx,
        score: typeof r.score === "number" && r.score >= 0 && r.score <= 1 ? r.score : 0.5,
        fit: typeof r.fit === "string" ? r.fit.slice(0, 120) : "",
      }));

    return { items: valid.sort((a, b) => b.score - a.score), tokens };
  }

  return {
    items: results.map((_, idx) => ({ idx, score: 0.5, fit: "Relevance not rated" })),
    tokens,
  };
}
