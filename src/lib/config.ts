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

// Hard limits
export const MAX_QUERY_LENGTH = 1000;

// Cost constants (public pricing as of 2026-06; verify before relying on dashboard $).
// See also estimateLlmCostUsd and EventLog writes.
export const EXA_USD_PER_REQUEST = 0.005; // $5 per 1k requests at searchAndContents tier (50 results = 1 request)
export const DEEPSEEK_USD_PER_1K_TOKENS = 0.00027; // chat-v3 blended input+output

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
