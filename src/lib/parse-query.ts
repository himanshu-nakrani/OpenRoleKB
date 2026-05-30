import { getLLM } from "@/lib/llm";
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

export async function parseQuery(rawQuery: string): Promise<{ filters: Filters; rawQuery: string }> {
  const llm = getLLM();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await llm.chat.completions.create(
      {
        model: "deepseek-chat",
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
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.type === "function" && toolCall.function.name === "extract_filters") {
      const filters = JSON.parse(toolCall.function.arguments) as Filters;
      return { filters, rawQuery };
    }

    return { filters: { role: rawQuery }, rawQuery };
  } catch {
    return { filters: { role: rawQuery }, rawQuery };
  }
}
