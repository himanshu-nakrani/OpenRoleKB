# OpenRoleKB Retrieval Improvement — Continuation Notes

**Last session:** 2026-06-06
**Branch:** `feat/mvp2-foundations-and-metrics` (3 commits ahead of origin, not pushed)
**Status:** Working tree clean, 120 tests pass, typecheck clean

---

## What's done

### 1. Quality audit (the problem statement)

Ran live `/api/search` against 7 representative queries. Found:
- 4 of 7 queries returned **zero results** after rerank.
- For `"staff software engineer Rust remote"`: Exa returned 50 results, **27/50 from ashbyhq.com** (blog posts, podcasts, customer stories, team pages), **0 had "Rust" in title**, only 5 mentioned Rust in body. The reranker correctly rejected all 50 — corpus quality issue, not pipeline bug.
- The same pattern for designer / frontend / etc.: top hits were Workable `/post-jobs-for-free/customize` *template* pages and Ashby `/resources/` marketing.

### 2. Deep research (the strategic choice)

Wrote a full deep-research report to:
`~/Documents/OpenRoleKB_Retrieval_Research_20260606/`
(MD + HTML + PDF, 4,677 words)

**Verdict:** Don't replace Exa with a crawler. Build a **hybrid**:
- **Layer A (primary):** ATS public APIs (Greenhouse / Lever / Ashby) ingested nightly → local Postgres `Job` table → search hits this first.
- **Layer B (fallback/discovery):** Exa, only when Layer A is weak. Every Exa hit that surfaces a new ATS slug enriches Layer A for everyone else.

Why: Greenhouse / Lever / Ashby all expose **free, no-auth, structured JSON APIs**. Verified by direct probe — Airbnb returned 234 clean structured jobs in 380ms.

### 3. Cross-check with GPT-5.5 review

GPT-5.5's independent analysis agreed on every load-bearing point. Sharpest contributions it added that we adopted:
- **JSON-LD `JobPosting` schema validation** as a deterministic quality gate (Google requires this schema only on single-posting pages).
- **URL allowlist** (positive patterns for individual ATS job URLs) on top of denylist.
- **`retrieval_quality` object shape** with `sourceType` + `rejectionReasons` for observability.

What we treated with skepticism:
- GPT-5.5 claimed Exa params `useAutoprompt` and `type: "neural"` are deprecated — unverified, didn't change.
- GPT-5.5 claimed `apply.workable.com/api/v3/accounts/{slug}/jobs` is public — unverified, deferred.

### 4. Code shipped (3 commits on `feat/mvp2-foundations-and-metrics`)

**Commit `535a4f8` — fix(llm): use gemini-flash-latest with reasoning_effort:none, real pricing, missing migration**
- `LLM_MODEL` from deprecated `gemini-2.0-flash` → `gemini-flash-latest`
- `reasoning_effort: "none"` in parse and rerank calls (Gemini 2.5 thinking tokens were starving output budget)
- `GEMINI_USD_PER_1K_TOKENS`: 0.00015 → 0.0014 (real 2.5-flash pricing)
- `cacheSearch` `$transaction` timeout: 5s default → 20s (cold Neon + 50 parallel upserts exceeded 5s)
- Added missing prisma migration `20260605195535_add_job_columns_and_drift_fixes` for `Job.locationRaw`, `salary*`, `dedupKey`, `SavedSearch.anonId` nullable, `VerificationToken.token` unique
- Rewrote `docs/cost-model.md` with new pricing

**Commit `ea9f6ed` — feat(retrieval): URL denylist filter + JSON-LD validator for Exa results**
- New `src/lib/retrieval-quality.ts`:
  - URL classifier with hard-deny path fragments (`/blog/`, `/resources/`, `/customers/`, `/podcast/`, `/team/`, `/product-updates/`, `/post-jobs-for-free/`, `/job-description/`, `/templates/`)
  - Per-ATS individual-job allowlist patterns (Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Workday/BambooHR/Recruitee/Teamtailor/Personio)
  - JSON-LD `JobPosting` detector (regex over `@type` and `itemtype`)
  - `filterResults()` returning `{ kept, rejected, counts }`
- `src/lib/exa.ts` exposes new `searchJobsWithReport()` (returns filtered results + counts) and keeps `searchJobs()` as a thin wrapper
- `src/app/api/search/route.ts` uses the reporting variant and emits a structured `retrieval_quality` log line per query
- 13 new unit tests in `src/lib/__tests__/retrieval-quality.test.ts`
- Updated 3 route tests (route, budget, contract) to mock both functions
- **Live measurement:** filter dropped **58–76% of raw Exa results per query** (29–38 denylist rejects out of 50). Every dropped URL was a confirmed marketing/template page.

**Commit `41f7608` — feat(retrieval): Greenhouse direct-ingestion POC script**
- `scripts/ingest-greenhouse.ts` — fetches `boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` for 21 known slugs, normalizes via `normalizeLocation` + `extractSalary` (shape parity with Exa-ingested rows), upserts into `Job` table
- Lazy prisma load so `--dry-run` works without `DATABASE_URL`
- **Live result on production Neon:**
  - 21/21 slugs returned data (Coinbase board exists but currently 0 jobs)
  - **3,972 real job postings ingested**
  - 100% location populated, 61% salary extracted, 24% remote flag detected
  - 0 upsert errors, 15 min wall time (cold Neon)
  - Spot-check counts on the corpus: 16 "Rust" titles (Exa returned 0), 881 Python descriptions, 892 senior roles, 65 designer roles

---

## Open issues found but not fixed

1. **Stripe `extractSalary` hit rate is anomalously low** (20/484 = 4% vs other companies 60–95%). Their description format must differ. Cheap investigation: read 3 Stripe job descriptions, see how salary is expressed, adjust regex.
2. **Intercom's Greenhouse board returns `company_name: "Fin"`** instead of "Intercom" (Fin is their AI product). Needs a per-slug `company_override` map for a handful of edge cases.
3. **Coinbase has 0 jobs at the slug.** Either paused or moved to a different ATS. Drop from seed list or just leave it (script handles 0-jobs gracefully).
4. **Gemini cap issue still present** — during the post-filter verification audit, every rerank failed with `500 status code`. Same account-level cap problem as the original session (https://ai.studio/spend). The filter measurements were still valid because the deny-counts come from the filter itself, but proper end-to-end reranked-quality verification still pending.
5. **JSON-LD validator is wired but unused as a filter.** Available via `assessResult(r).quality.hasJobPostingSchema`. Promoting it from "soft signal" to "hard filter" needs an experiment (Exa truncates text to 2000 chars — may not always contain the JSON-LD blob).

---

## Where the code lives

| File | Purpose |
|---|---|
| `src/lib/retrieval-quality.ts` | URL classifier + JSON-LD detector + `filterResults` |
| `src/lib/__tests__/retrieval-quality.test.ts` | 13 unit tests |
| `src/lib/exa.ts` | `searchJobsWithReport()` (filtered) + `searchJobs()` (thin wrapper) |
| `src/app/api/search/route.ts` | Uses reporting variant, emits `retrieval_quality` log line |
| `src/lib/cache.ts` | Has the 20s `$transaction` timeout fix |
| `scripts/ingest-greenhouse.ts` | POC, run with `npx tsx --env-file=.env scripts/ingest-greenhouse.ts` |
| `prisma/migrations/20260605195535_add_job_columns_and_drift_fixes/` | Missing schema migration that was finally created |
| `~/Documents/OpenRoleKB_Retrieval_Research_20260606/` | Deep research report (MD + HTML + PDF) |

---

## Next steps when you come back

In ascending scope:

### 0. (5 min) Push the branch and open a PR
```bash
git push -u origin feat/mvp2-foundations-and-metrics
gh pr create --title "Retrieval quality: URL filter + JSON-LD validator + Greenhouse POC" \
  --body "See commits 535a4f8, ea9f6ed, 41f7608"
```
This is the cheapest action and the lowest-risk way to lock in what we did.

### 1. (30 min) Fix the 4 stragglers
- Add a `COMPANY_OVERRIDE: Record<string, string>` map in `scripts/ingest-greenhouse.ts` for `{ intercom: "Intercom" }`.
- Read 2–3 Stripe job descriptions to see why salary regex misses, adjust `src/lib/salary.ts`.
- Drop or comment out `coinbase` in the seed list.
- Verify the Gemini account cap at https://ai.studio/spend before next live-quality test.

### 2. (1 focused session, ~3 hours) Lever + Ashby adapters
Same pattern as `scripts/ingest-greenhouse.ts`. Endpoints already verified:
- Lever: `GET https://api.lever.co/v0/postings/{slug}?mode=json`
- Ashby: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`

Refactor opportunity: there's likely a clean abstraction across the three adapters (`AtsAdapter` interface with `fetchBoard` + `normalizeJob`). Don't pre-extract on the first one; do it after the third when the shape is clear.

Each adapter probably brings 3,000–5,000 more rows. Combined corpus target: ~15,000 jobs.

### 3. (Bigger — own session) Wire Layer A into the search path
**The architectural change. This is where the user-facing quality lift actually lands.**

Design decisions to make first (don't just start coding):
- **Local search backend:** Postgres full-text search (`tsvector` / `tsquery`) vs trigram (`pg_trgm`) vs pgvector embeddings. Default recommendation: start with full-text (built into Postgres, free, decent quality). Add embeddings only if FTS quality is insufficient.
- **Schema work:** Add a `tsvector` GENERATED column to `Job` for `title || description || company`, with a GIN index. ~10-line Prisma migration.
- **Fallback threshold:** When does Layer A "give up" and call Exa? Proposed heuristic: fewer than 5 results above some BM25 score floor. Tune by trial.
- **SSE event shape:** Should the existing `results` event carry both local + Exa rows once they merge? Or stream local first as a partial event? Probably the latter for UX.
- **Discovery feedback loop:** Layer B's Exa results should extract new ATS slugs into a `discovered_slugs` table for manual review (don't auto-ingest — adversarial slug injection risk).

This is a 1–2 session piece of work. Worth scoping into a plan doc before starting.

### 4. (Later) Promote JSON-LD detector from soft signal to hard filter
Once we have telemetry on `hasJobPostingSchema` hit rates per source, decide whether to require it for non-ATS-hosted URLs.

### 5. (Later) Reduce Exa dependence
After 6 months of Layer B telemetry: if fewer than 5% of queries trigger Exa fallback, consider removing Exa from the runtime path entirely (keep it as a periodic slug-discovery job).

---

## Useful one-liners for next session

```bash
# Re-run the 7-query quality audit (writes results to stdout)
/tmp/audit.sh  # if still present, else regenerate from this doc

# Re-ingest Greenhouse (dry run)
npx tsx scripts/ingest-greenhouse.ts --dry-run

# Run all tests
npm test

# Typecheck
npx tsc --noEmit

# Count current local corpus by source
npx tsx --env-file=.env -e 'import("@/lib/prisma").then(m => m.prisma.job.groupBy({by:["source"],_count:{_all:true}}).then(r=>{console.log(r);return m.prisma.$disconnect()}))'

# Check Gemini account cap status
curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Authorization: Bearer $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-flash-latest","messages":[{"role":"user","content":"ping"}],"max_tokens":5,"reasoning_effort":"none"}' \
  | head -c 500
```

---

## State summary at end of session

- **Branch:** `feat/mvp2-foundations-and-metrics`, 3 commits ahead of origin
- **Commits to push:** `535a4f8`, `ea9f6ed`, `41f7608`
- **Tests:** 120 passing
- **Working tree:** clean
- **Production Neon:** contains 3,972 fresh Greenhouse-ingested jobs (4,140 total Job rows including older Exa-sourced rows)
- **Filter measurably working in prod path:** 58–76% rejection rate on Exa noise
- **End-to-end reranked quality:** un-measured this session due to Gemini account cap (`500 status code`); the filter and ingestion are independently verified
