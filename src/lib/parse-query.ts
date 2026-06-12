import { getLLM, getLLMModel, getLLMReasoningEffort } from "@/lib/llm";
import type { Filters } from "@/types/job";
import type OpenAI from "openai";
import { CITY_SYNONYMS, COUNTRY_ALIASES, findCitiesInText, normalizeText } from "@/lib/city-synonyms";
import { log } from "@/lib/logger";

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
          yearsExperience: { type: "number", description: "Years of work experience explicitly requested, e.g. '3 years' -> 3" },
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
  if (typeof f.yearsExperience === "number" && Number.isFinite(f.yearsExperience) && f.yearsExperience >= 0) {
    out.yearsExperience = Math.min(Math.floor(f.yearsExperience), 80);
  }
  if (Array.isArray(f.exclude)) out.exclude = f.exclude.filter((s): s is string => typeof s === "string").slice(0, 20);
  if (typeof f.freshnessDays === "number" && Number.isFinite(f.freshnessDays) && f.freshnessDays > 0) {
    out.freshnessDays = Math.min(Math.floor(f.freshnessDays), 365);
  }
  return out;
}


const FILLER_WORDS = new Set([
  "role",
  "roles",
  "job",
  "jobs",
  "in",
  "for",
  "with",
  "of",
  "year",
  "years",
  "yr",
  "yrs",
  "experience",
  "exp",
  "and",
  "or",
  "the",
  "a",
  "an",
  "to",
  "at",
  "remote",
]);

const CITY_WORDS = new Set(
  CITY_SYNONYMS.flatMap((entry) => entry.synonyms.flatMap((synonym) => normalizeText(synonym).split(/\s+/))),
);
const COUNTRY_WORDS = new Set(Object.keys(COUNTRY_ALIASES).flatMap((country) => country.split(/\s+/)));

function degradedParse(rawQuery: string): Filters {
  const filters: Filters = {};
  const years = rawQuery.match(/(\d+)\+?\s*(?:years?|yrs?)/i);
  if (years) filters.yearsExperience = Math.min(Number(years[1]), 80);

  const cities = findCitiesInText(rawQuery);
  if (cities.length) {
    filters.location = cities.map((city) => city.canonical).join(" or ");
  } else {
    const words = normalizeText(rawQuery).split(/\s+/);
    const country = Object.keys(COUNTRY_ALIASES).find((alias) => {
      const aliasWords = alias.split(/\s+/);
      return aliasWords.every((word) => words.includes(word));
    });
    if (country) filters.location = country;
  }

  if (/\b(remote|remote-first|work from home|wfh)\b/i.test(rawQuery)) {
    filters.remote = true;
  }

  const tokens = normalizeText(rawQuery)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !FILLER_WORDS.has(token))
    .filter((token) => !CITY_WORDS.has(token))
    .filter((token) => !COUNTRY_WORDS.has(token));

  const role = Array.from(new Set(tokens)).slice(0, 4).join(" ");
  if (role) filters.role = role;

  return filters.role || filters.location || filters.remote !== undefined || filters.yearsExperience !== undefined
    ? filters
    : { role: rawQuery };
}

export async function parseQuery(
  rawQuery: string,
  signal?: AbortSignal,
): Promise<{ filters: Filters; rawQuery: string; parseError?: string; tokens?: number }> {
  const trimmed = rawQuery.trim();

  const hasYearsExperience = /\b\d+\+?\s*(?:years?|yrs?)\b/i.test(trimmed);
  const hasCityFilter = findCitiesInText(trimmed).length > 0;
  if (hasYearsExperience && hasCityFilter) {
    return { filters: degradedParse(trimmed), rawQuery, tokens: 0 };
  }

  // Fast-path for simple queries (mostly just a role title, no obvious filter keywords).
  // Saves LLM cost/tokens/latency for common cases like "react engineer" or saved searches
  // that already have rich filters stored (merged later in cron).
  const FILTER_TRIGGERS =
    /\b(remote|senior|junior|staff|lead|manager|director|vp|c-suite|intern|mid|level|eu|us|uk|india|canada|australia|nyc|sf|berlin|london|paris|tokyo|singapore|toronto|sydney|fintech|crypto|blockchain|no |exclude|avoid|this (week|month|year)|last (24h|week|month)|posted|salary|\$\d|k\+|remote-first|work from|based in)\b/i;

  if (trimmed.length > 0 && trimmed.length < 80 && !hasCityFilter && !FILTER_TRIGGERS.test(trimmed) && trimmed.split(/\s+/).length <= 5 && !/\b[A-Z][a-z]{2,}\b/.test(trimmed)) {
    return { filters: { role: trimmed }, rawQuery, tokens: 0 };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const llm = getLLM();
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 4000);

    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const response = await llm.chat.completions.create(
      {
        model: getLLMModel(),
        max_tokens: 500,
        temperature: 0,
        reasoning_effort: getLLMReasoningEffort(),
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

    const parseError = "No tool call in response";
    log.warn({ evt: "parse_error", parseError });
    return { filters: degradedParse(rawQuery), rawQuery, parseError, tokens };
  } catch (err) {
    if (timeout) clearTimeout(timeout);
    const parseError = err instanceof Error ? err.message : String(err);
    log.warn({ evt: "parse_error", parseError });
    return {
      filters: degradedParse(rawQuery),
      rawQuery,
      parseError,
    };
  }
}
