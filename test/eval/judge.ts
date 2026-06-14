/**
 * Independent LLM judge for eval.
 *
 * Critically uses a DIFFERENT rubric than src/lib/rerank.ts so we are not
 * grading the reranker with itself. Each top-N result is scored across five
 * dimensions with a one-line JD citation per dimension; missing evidence
 * returns score=0 with "none" so the judge can't paper over thin matches.
 */
import { getLLM, getLLMModel, getLLMReasoningEffort } from "@/lib/llm";
import type { ExaResult } from "@/types/job";
import type OpenAI from "openai";

const JUDGE_RUBRIC = `You are an INDEPENDENT relevance judge for a job-search system.
You are NOT the system that produced this ranking — your job is to grade whether the posting really answers the user's query, ignoring whatever scores the system already gave it.

Score each dimension 0.0 to 1.0:
- role_match:      Does the JD describe the role the user asked for?
- seniority_match: Does the JD's stated seniority/YoE match what the user asked for? Junior ≠ Senior. Treat seniority as a HARD constraint — a Senior posting for a "junior" query MUST score ≤0.2 on this dimension.
- location_match:  Does the JD say the job is in / open to the city/country/remote the user asked for? "Remote" must be in the body, not inferred.
- skills_match:    For each skill the user explicitly named, does the JD mention it (or a clear synonym)? If the user didn't name skills, return 1.0.
- exclusions_clean: Score 1.0 if NONE of the user's excluded terms appear in the JD. Each appearance drops it (0.5 if mentioned once, 0.0 if central to the role).

For EVERY dimension, include a SHORT (max 80 chars) one-line "evidence" quoting or paraphrasing the JD substring that supports the score. If there is no evidence, write "none".

Then assign overall = a holistic 0-1 judgement of whether this user would be served by this posting (NOT a simple average — weight role + seniority + location heavily, exclusions are gating).

Be parsimonious. Don't reward "could be related" matches.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "judge_postings",
      description: "Score each posting against the user query.",
      parameters: {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                idx: { type: "number" },
                role_match: { type: "object", properties: { score: { type: "number" }, evidence: { type: "string" } }, required: ["score", "evidence"] },
                seniority_match: { type: "object", properties: { score: { type: "number" }, evidence: { type: "string" } }, required: ["score", "evidence"] },
                location_match: { type: "object", properties: { score: { type: "number" }, evidence: { type: "string" } }, required: ["score", "evidence"] },
                skills_match: { type: "object", properties: { score: { type: "number" }, evidence: { type: "string" } }, required: ["score", "evidence"] },
                exclusions_clean: { type: "object", properties: { score: { type: "number" }, evidence: { type: "string" } }, required: ["score", "evidence"] },
                overall: { type: "object", properties: { score: { type: "number" }, why: { type: "string" } }, required: ["score", "why"] },
              },
              required: ["idx", "role_match", "seniority_match", "location_match", "skills_match", "exclusions_clean", "overall"],
            },
          },
        },
        required: ["results"],
      },
    },
  },
];

const JUDGE_BODY_CHARS = 2000;
const JUDGE_BATCH_SIZE = 5;

export interface JudgeDim {
  score: number;
  evidence: string;
}

export interface JudgeRow {
  idx: number;
  role_match: JudgeDim;
  seniority_match: JudgeDim;
  location_match: JudgeDim;
  skills_match: JudgeDim;
  exclusions_clean: JudgeDim;
  overall: { score: number; why: string };
}

export interface JudgeResult {
  rows: JudgeRow[];
  tokens?: number;
}

export async function judge(
  rawQuery: string,
  candidates: Array<{ result: ExaResult; idx: number }>,
  signal?: AbortSignal,
): Promise<JudgeResult> {
  if (candidates.length === 0) return { rows: [] };

  const batches: Array<Array<{ result: ExaResult; idx: number }>> = [];
  for (let i = 0; i < candidates.length; i += JUDGE_BATCH_SIZE) {
    batches.push(candidates.slice(i, i + JUDGE_BATCH_SIZE));
  }

  const judged = await Promise.all(batches.map((b) => judgeBatch(rawQuery, b, signal)));
  const rows = judged.flatMap((r) => r.rows);
  const tokens = judged.reduce<number | undefined>((sum, r) => {
    if (r.tokens === undefined) return sum;
    return (sum ?? 0) + r.tokens;
  }, undefined);
  return { rows, tokens };
}

async function judgeBatch(
  rawQuery: string,
  batch: Array<{ result: ExaResult; idx: number }>,
  signal?: AbortSignal,
): Promise<JudgeResult> {
  const llm = getLLM();

  const list = batch
    .map(({ result: r, idx }) => {
      const loc = r.location ? ` [location field: ${r.location}]` : "";
      return `${idx}. ${r.title}${loc}\n   ${r.text.substring(0, JUDGE_BODY_CHARS)}`;
    })
    .join("\n\n");

  const response = await llm.chat.completions.create(
    {
      model: getLLMModel(),
      max_tokens: 4000,
      temperature: 0,
      reasoning_effort: getLLMReasoningEffort(),
      messages: [
        { role: "system", content: JUDGE_RUBRIC },
        { role: "user", content: `User query: "${rawQuery}"\n\nJudge these postings:\n\n${list}` },
      ],
      tools: TOOLS,
      tool_choice: { type: "function", function: { name: "judge_postings" } },
    },
    { signal },
  );

  const tokens = response.usage?.total_tokens;
  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (call?.type === "function" && call.function.name === "judge_postings") {
    const parsed = JSON.parse(call.function.arguments) as { results: JudgeRow[] };
    return { rows: parsed.results ?? [], tokens };
  }
  return { rows: [], tokens };
}
