export interface Filters {
  role?: string;
  seniority?: string;
  skills?: string[];
  location?: string;
  remote?: boolean;
  salaryMin?: number;
  yearsExperience?: number;
  exclude?: string[];
  freshnessDays?: number;
}

export interface ExaResult {
  id: string;
  title: string;
  url: string;
  text: string;
  highlights: string[];
  publishedDate?: string;
  author?: string;
  /**
   * Last time we observed this job in any search result. Populated only on
   * cache-hit (`adaptToExaShape`); undefined for fresh-from-Exa rows because
   * we haven't written/refreshed the Job row yet. Used by StillListedBadge.
   */
  lastSeenAt?: string;
  // P2 salary extraction
  salaryMinUsd?: number;
  salaryMaxUsd?: number;
  salaryRaw?: string;
  dedupKey?: string;
}

export interface RerankItem {
  idx: number;
  score: number;
  fit: string;
}

export interface ParsedQuery {
  filters: Filters;
  rawQuery: string;
}

export interface SearchResponse {
  filters: Filters;
  exaResults: ExaResult[];
  reranked: RerankItem[];
}

export interface SSEEvent {
  event: "parsed" | "results" | "rerank" | "done" | "error";
  data: unknown;
}
