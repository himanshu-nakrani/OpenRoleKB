import { getLLM } from "@/lib/llm";
import { LLM_MODEL } from "@/lib/config";
import type { Filters } from "@/types/job";
import type OpenAI from "openai";

const TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "extract_filters",
      description: "Extract structured job search filters from a natural language query",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", description: "Job title or role sought" },
          seniority: {
            type: "string",
            description: "Seniority: intern, junior, mid, senior, staff, lead, manager, director, vp, c-suite",
          },
          skills: { type: "array", items: { type: "string" }, description: "Technical or soft skills mentioned" },
          location: { type: "string", description: "City, state, country, region, or timezone" },
          remote: { type: "boolean", description: "Whether remote-friendly roles are wanted" },
          salaryMin: { type: "number", description: "Minimum annual salary in USD" },
          exclude: { type: "array", items: { type: "string" }, description: "Industries, tech, or company types to AVOID" },
          freshnessDays: { type: "number", description: "Max age in days. 'this month'→30, 'this week'→7, 'last 24h'→1" },
        },
      },
    },
  },
];

export function sanitizeFilters(raw: unknown): Filters {
  if (raw === null || typeof raw !== "object") return {};
  const f = raw as Record<string, unknown>;
  const out: Filters = {};
  if (typeof f.role === "string" && f.role.trim()) out.role = f.role.trim().slice(0, 200);
  if (typeof f.seniority === "string") out.seniority = f.seniority.trim().slice(0, 50);
  if (Array.isArray(f.skills)) out.skills = f.skills.filter((s): s is string => typeof s === "string").slice(0, 20);
  if (typeof f.location === "string") out.location = f.location.trim().slice(0, 100);
  if (typeof f.remote === "boolean") out.remote = f.remote;
  if (typeof f.salaryMin === "number" && Number.isFinite(f.salaryMin) && f.salaryMin > 0) out.salaryMin = Math.floor(f.salaryMin);
  if (Array.isArray(f.exclude)) out.exclude = f.exclude.filter((s): s is string => typeof s === "string").slice(0, 20);
  if (typeof f.freshnessDays === "number" && Number.isFinite(f.freshnessDays) && f.freshnessDays > 0) {
    out.freshnessDays = Math.min(Math.floor(f.freshnessDays), 365);
  }
  return out;
}

export async function parseQuery(
  rawQuery: string,
  signal?: AbortSignal,
): Promise<{ filters: Filters; rawQuery: string; parseError?: string; tokens?: number }> {
  const trimmed = rawQuery.trim();

  // Fast-path for simple queries (mostly just a role title, no obvious filter keywords).
  // Saves LLM cost/tokens/latency for common cases like "react engineer" or saved searches
  // that already have rich filters stored (merged later in cron).
  const FILTER_TRIGGERS =
    /\b(remote|senior|junior|staff|lead|manager|director|vp|c-suite|intern|mid|level|eu|us|nyc|sf|berlin|london|paris|tokyo|singapore|toronto|sydney|fintech|crypto|blockchain|no |exclude|avoid|this (week|month|year)|last (24h|week|month)|posted|salary|\$\d|k\+|remote-first|work from|based in)\b/i;

  if (trimmed.length > 0 && trimmed.length < 80 && !FILTER_TRIGGERS.test(trimmed) && trimmed.split(/\s+/).length <= 5 && !/\b[A-Z][a-z]{2,}\b/.test(trimmed)) {
    return { filters: { role: trimmed }, rawQuery, tokens: 0 };
  }

  try {
    const llm = getLLM();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const response = await llm.chat.completions.create(
      {
        model: LLM_MODEL,
        max_tokens: 500,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You extract structured job search filters from natural language queries. Be precise and literal — don't invent filters the user didn't mention. Omit fields that aren't explicitly or strongly implied in the query.",
          },
          { role: "user", content: rawQuery },
        ],
        tools: TOOLS,
        tool_choice: { type: "function", function: { name: "extract_filters" } },
      },
      { signal: combinedSignal },
    );

    clearTimeout(timeout);

    const tokens = response.usage?.total_tokens;
    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.type === "function" && toolCall.function.name === "extract_filters") {
      const parsed = JSON.parse(toolCall.function.arguments);
      const filters = sanitizeFilters(parsed);
      return { filters, rawQuery, tokens };
    }

    return { filters: { role: rawQuery }, rawQuery, parseError: "No tool call in response", tokens };
  } catch (err) {
    return {
      filters: { role: rawQuery },
      rawQuery,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}
