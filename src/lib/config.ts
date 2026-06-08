/**
 * Central configuration for OpenRoleKB.
 *
 * Keep tunable constants here (not scattered magic numbers) so they are easy to
 * reason about, document, and change. Import from this module everywhere.
 *
 * Update docs/cost-model.md + .env.example comments when pricing-related values change.
 */

export const CACHE_TTL_HOURS = 6;

// Minimum LLM rerank score to surface a result (sub-0.4 are filtered client + server).
export const MIN_RERANK_SCORE = 0.4;

// Exa neural search result count per query (drives cost + downstream rerank payload).
export const EXA_NUM_RESULTS = 50;

// Layer A (local Postgres FTS over ingested ATS corpus) returns this many results
// max per query before reranking. Matches EXA_NUM_RESULTS so token budgets are
// comparable across paths.
export const LOCAL_SEARCH_MAX_RESULTS = 50;

// If Layer A returns fewer than this many candidates (after post-filtering),
// fire Exa as a fallback / discovery pass and merge.
export const LAYER_A_FALLBACK_THRESHOLD = 5;

// Hard limits
export const MAX_QUERY_LENGTH = 1000;

// Cost constants (public pricing as of 2026-06; verify before relying on dashboard $).
// See also estimateLlmCostUsd and EventLog writes.
export const EXA_USD_PER_REQUEST = 0.005; // $5 per 1k requests at searchAndContents tier (50 results = 1 request)
// gemini-flash-latest is a floating alias maintained by Google to point at the
// current production Flash model (today: 2.5-flash). We disable "thinking"
// tokens via reasoning_effort:"none" on each call so output isn't starved.
export const LLM_MODEL = "gemini-flash-latest";
// Blended ~ (input + output) / 2 at 2.5-flash public pricing
// ($0.30/M input + $2.50/M output ≈ $1.40/M ≈ $0.0014/1k).
export const GEMINI_USD_PER_1K_TOKENS = 0.0014;

// Cron / retention windows (days)
export const CACHE_PURGE_DAYS = 7;
export const ANON_DATA_RETENTION_DAYS = 30;

// Freshness "this week" window used in UI + filters
export const FRESHNESS_WEEK_DAYS = 7;

// Rate limiting windows (used by rate-limit.ts)
export const RATE_LIMIT_IP_WINDOW_MS = 60_000;
export const RATE_LIMIT_IP_MAX = 10;
export const RATE_LIMIT_OWNER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RATE_LIMIT_OWNER_MAX = 100;

// Max chars of job text sent to reranker (to control token cost / latency of the 50-result LLM call).
// Title + URL + this many chars per result.
export const RERANK_TEXT_CHARS = 200;
