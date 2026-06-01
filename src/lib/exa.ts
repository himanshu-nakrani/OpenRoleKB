import Exa from "exa-js";
import type { Filters, ExaResult } from "@/types/job";

const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "bamboohr.com",
  "recruitee.com",
  "personio.de",
  "teamtailor.com",
];

let exaClient: Exa | null = null;

function getExa(): Exa {
  if (!exaClient) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error("EXA_API_KEY environment variable is not set");
    }
    exaClient = new Exa(apiKey);
  }
  return exaClient;
}

function buildQueryString(filters: Filters): string {
  const parts: string[] = [];

  if (filters.role) parts.push(filters.role);
  if (filters.seniority) parts.push(filters.seniority);
  if (filters.skills?.length) parts.push(filters.skills.join(" "));
  if (filters.location) parts.push(filters.location);
  if (filters.remote) parts.push("remote");
  parts.push("job posting");

  if (filters.exclude?.length) {
    return parts.join(" ") + " -" + filters.exclude.join(" -");
  }

  return parts.join(" ");
}

export async function searchJobs(
  query: string,
  filters: Filters,
  signal?: AbortSignal,
): Promise<ExaResult[]> {
  const exa = getExa();
  const queryStr = buildQueryString(filters);

  const params: Record<string, unknown> = {
    numResults: 50,
    type: "neural",
    contents: {
      text: { maxCharacters: 2000 },
      highlights: { numSentences: 3 },
    },
    includeDomains: ATS_DOMAINS,
    userLocation: "US",
  };

  if (filters.freshnessDays && filters.freshnessDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - filters.freshnessDays);
    params.startPublishedDate = since.toISOString();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await exa.searchAndContents(queryStr, { ...params, signal } as any);

  if (!response.results?.length) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return response.results.map((r: any) => ({
    id: r.id,
    title: r.title || "Untitled",
    url: r.url,
    text: r.text || "",
    highlights: r.highlights || [],
    publishedDate: r.publishedDate,
    author: r.author,
  }));
}
