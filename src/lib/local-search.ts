import { prisma } from "@/lib/prisma";
import { extractSalary } from "@/lib/salary";
import { locationMatches } from "@/lib/city-synonyms";
import type { Filters, ExaResult } from "@/types/job";

// Postgres `tsquery` has fragile syntax — bare punctuation, leading operators,
// unbalanced parens, or empty terms all error out. Sanitize by stripping
// anything that isn't a word character or whitespace, then joining the
// remaining tokens with `&` (AND) inside `to_tsquery`. AND across all terms
// is the recall ceiling we want for a first cut; the reranker will sort the
// resulting candidate set.
function tokensFromQuery(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.role) parts.push(filters.role);
  if (filters.seniority) parts.push(filters.seniority);
  if (filters.skills?.length) parts.push(...filters.skills);
  // Location and remote are post-filtered below — including them in the
  // tsquery would over-constrain (a "remote" job posting might say
  // "this role is location-flexible" without ever using the word "remote").
  return parts
    .flatMap((p) =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 2),
    )
    .filter(Boolean);
}

function buildTsQuery(filters: Filters): string | null {
  const tokens = tokensFromQuery(filters);
  if (!tokens.length) return null;
  // de-dupe to keep query string short
  const unique = Array.from(new Set(tokens));
  return unique.join(" & ");
}

interface LocalJobRow {
  id: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  isRemote: boolean | null;
  description: string | null;
  publishedAt: Date | null;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryRaw: string | null;
  lastSeenAt: Date;
  rank: number;
}

function rowToExaResult(r: LocalJobRow): ExaResult {
  return {
    id: r.id, // stable Job.id — survives the rerank/cache path cleanly
    title: r.title,
    url: r.url,
    text: r.description ?? "",
    highlights: [],
    publishedDate: r.publishedAt?.toISOString(),
    author: r.company ?? undefined,
    company: r.company ?? undefined,
    location: r.location ?? undefined,
    lastSeenAt: r.lastSeenAt.toISOString(),
    salaryMinUsd: r.salaryMinUsd ?? undefined,
    salaryMaxUsd: r.salaryMaxUsd ?? undefined,
    salaryRaw: r.salaryRaw ?? undefined,
  };
}

export interface LocalSearchResult {
  results: ExaResult[];
  /** raw FTS hit count before post-filtering — useful for telemetry */
  rawHits: number;
  /** tsquery actually executed; null when no tokens to query */
  tsquery: string | null;
}

/**
 * Layer A retrieval against the local Job corpus (Greenhouse-ingested rows).
 *
 * Order:
 *  1. Build a tsquery from role + seniority + skills (location/remote excluded
 *     because they over-constrain — handled as post-filters instead).
 *  2. Pull top `limit` hits via Postgres FTS + ts_rank.
 *  3. Post-filter by isRemote (when the user asked for remote).
 *  4. Normalize to ExaResult so the existing rerank + cache layers reuse.
 *
 * Returns empty if no useful tokens or no rows match. Caller decides
 * whether to call Exa as fallback based on `results.length`.
 */
export async function searchLocalJobs(
  filters: Filters,
  limit = 50,
): Promise<LocalSearchResult> {
  const tsquery = buildTsQuery(filters);
  if (!tsquery) return { results: [], rawHits: 0, tsquery: null };

  const prefilterLimit = filters.location ? Math.max(limit * 40, 2000) : limit;
  const rows = await prisma.$queryRaw<LocalJobRow[]>`
    SELECT id, url, title, company, location, "isRemote", description,
           "publishedAt", "salaryMinUsd", "salaryMaxUsd", "salaryRaw",
           "lastSeenAt",
           ts_rank("search_doc", to_tsquery('english', ${tsquery})) AS rank
    FROM "Job"
    WHERE "search_doc" @@ to_tsquery('english', ${tsquery})
    ORDER BY rank DESC, "publishedAt" DESC NULLS LAST
    LIMIT ${prefilterLimit}
  `;

  // Post-filter remote when the user explicitly asked for it. Allow nulls
  // through — many real remote jobs don't have isRemote populated because
  // the regex in extractLocation only fires on certain phrasings.
  let filtered = rows;
  if (filters.remote === true) {
    filtered = filtered.filter((r) => r.isRemote !== false);
  }
  if (filters.location) {
    filtered = filtered.filter((r) => locationMatches(r.location, filters.location));
  }

  // Backfill salary on the small subset where ingest missed it but the
  // text contains it. Cheap because description is already in memory.
  const adapted = filtered.slice(0, limit).map((r) => {
    const out = rowToExaResult(r);
    if (!out.salaryMinUsd && !out.salaryMaxUsd && !out.salaryRaw && out.text) {
      const sal = extractSalary(out.text);
      if (sal.min || sal.max || sal.raw) {
        out.salaryMinUsd = sal.min;
        out.salaryMaxUsd = sal.max;
        out.salaryRaw = sal.raw;
      }
    }
    return out;
  });

  return { results: adapted, rawHits: rows.length, tsquery };
}
