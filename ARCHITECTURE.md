# Architecture

A map of the codebase for anyone ramping up. Aim: read this once, then make a
non-trivial PR within a day.

## 30-second overview

OpenRoleKB is a Next.js 16 App Router app with one critical path:

```
User types a query
      │
      ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  DeepSeek    │──▶│     Exa      │──▶│   DeepSeek   │
│  parseQuery  │   │  searchJobs  │   │    rerank    │
└──────────────┘   └──────────────┘   └──────────────┘
      │                  │                   │
      ▼                  ▼                   ▼
   filters            ExaResult[]       RerankItem[]
      │                  │                   │
      └─────── Server-Sent Events stream ────┘
                         │
                         ▼
                  React client renders
                  incrementally as
                  events arrive
```

Everything else (saved searches, hidden companies, feedback, auth, account
transfer, etc.) is supporting infrastructure around that pipeline.

## Module layout

```
src/
├── app/                      Next.js App Router
│   ├── page.tsx              Home — hero + search + results
│   ├── layout.tsx            Root metadata + theme bootstrap
│   ├── globals.css           Aurora theme tokens (mirrors src/lib/tokens.ts)
│   ├── api/
│   │   ├── search/route.ts   SSE-streaming POST /api/search
│   │   ├── saved/route.ts    Saved-search CRUD (anon + user identity)
│   │   ├── interactions/     Per-job actions (saved/hidden/applied/dismissed)
│   │   ├── hidden-companies/ Hide-company list
│   │   ├── feedback/         Bad-match feedback events
│   │   ├── auth/             NextAuth + anon→user merge
│   │   ├── transfer-code/    Cross-device anonymous account transfer
│   │   ├── og/route.tsx      Dynamic OG image (edge runtime)
│   │   ├── cron/             Scheduled jobs (cache purge etc.)
│   │   └── health/           Liveness probe
│   ├── admin/                Internal-only health + feedback dashboards
│   └── search/[id]/          Permalinked cached search result page
├── components/               UI primitives
│   ├── SearchBox             Query input + filter chips + SSE consumer
│   ├── ResultsList           Left pane: ranked results
│   ├── DetailPane / Sheet    Right pane: selected job, formatted description
│   ├── LoadingNarrative      "Parsing → Searching → Ranking" pipeline UI
│   └── ...
├── lib/                      Domain logic, framework-agnostic
│   ├── parse-query.ts        LLM tool-call → Filters, sanitizeFilters validator
│   ├── exa.ts                Exa SDK wrapper, ATS allowlist, query building
│   ├── rerank.ts             LLM rubric-based scoring + index sanitization
│   ├── cache.ts              SearchCache + Job upserts, ExaResult-shape adapter
│   ├── hash.ts               Canonical query hashing for cache keys
│   ├── location.ts           "Location:" extraction from raw text
│   ├── company.ts            ATS-host-aware company-name extraction
│   ├── rate-limit.ts         Upstash + in-memory fallback
│   ├── owner.ts              getOwnerIdentity (anon vs signed-in)
│   ├── observe.ts            captureRouteError wraps Sentry + logger
│   ├── logger.ts             Structured JSON logs with PII scrubbing
│   ├── tokens.ts             Design tokens (palette/motion/type)
│   └── motion.ts             JS-side motion helpers
├── hooks/                    React hooks
└── types/job.ts              Shared TS types (Filters, ExaResult, RerankItem)

prisma/
├── schema.prisma             Source of truth for DB
└── migrations/               SQL migrations applied in order

generated/prisma/             Generated client + types (committed)

test/                         Vitest fixtures + integration setup
```

## The search pipeline in detail

`src/app/api/search/route.ts` is the heart. Read it top to bottom — it is the
clearest entry point for understanding everything else.

1. **Authentication** (`getOwnerKey`) — returns a signed-in user id, a validated
   `x-anon-id` header, or `null`.
2. **Rate limiting** (`rateLimit`) — Upstash sliding/fixed windows in prod, an
   in-memory bucket in local dev.
3. **Body validation** — guards against empty query, query > 1000 chars,
   sanitizes any `filters` override from the client.
4. **SSE stream opens** — every later step pipes events through this stream:
   - `parsed`  → the structured `Filters` (sanitized) so the UI can show chips.
   - `results` → the raw `ExaResult[]` so the UI can render skeletons-with-titles.
   - `rerank`  → the LLM rubric scores so the UI can reorder + filter.
   - `done`    → final cache id (`null` if rerank failed).
   - `error`   → only on a fatal upstream failure.
5. **Cache hit** (`getCachedSearch`) — returns adapted `ExaResult`-shaped jobs
   from the SearchCache row. Hide-company filter still applies.
6. **Cache miss** — call Exa, then rerank, then apply hide-company filter.
   On rerank failure: fall back to score 0.5 for everything AND skip caching so
   the bad result set doesn't poison the cache.
7. **Metrics** — `logMetrics` writes an `EventLog` row with parseMs/exaMs/
   rerankMs/cacheMs/totalMs + `rerankFailed`. Fire-and-forget; never blocks the
   SSE close.

## Data model highlights

```
User ──< SavedSearch ──> Job ──< JobInteraction (saved/hidden/applied/dismissed)
                                └── FeedbackEvent (per-job rating)

User has anonId for anon→user merge
HiddenCompany keyed by ownerKey (anonId or userId)
SearchCache keyed by queryHash (sha256 over normalized query + canonicalized filters)
EventLog records every search request for observability
```

See `prisma/schema.prisma` for the complete schema.

## Why these tools

- **Exa** for search: it is the only neural-search API that crawls career pages
  in near-real-time. Boolean indexes (LinkedIn, Indeed) lag by hours-to-days.
- **DeepSeek** for parse + rerank: cheap (~$0.0002/search), fast (~700ms),
  tool-calling support is solid. Swap-friendly — see `src/lib/llm.ts`.
- **Postgres + Prisma**: standard, boring, easy to back up.
- **Upstash Redis** for rate limiting: edge-friendly REST API, costs $0 for
  the volume we expect.
- **NextAuth (Auth.js v5)**: handles the magic-link email flow that lets anon
  users upgrade to accounts without disrupting their saved data.
- **Sentry**: error tracking + release markers.

## What we deliberately do NOT do

- **No worker queue / background jobs** (yet). Everything happens inside the
  user's request. Saved-search cadence (planned) will be the first reason to
  introduce a queue.
- **No GraphQL / tRPC**. Plain REST + SSE keeps the surface area small.
- **No state library**. `useState` + a tiny event bus on `window` for
  cross-component pings (`openrolekb:saved-changed`).
- **No service worker / offline mode**. The product is a thin client over
  remote data; offline is meaningless.
- **No multi-tenant org concept**. Single-user product.

## Where to make your first change

- `src/components/` for UI tweaks — TypeScript + Tailwind, no surprises.
- `src/lib/parse-query.ts` + `src/lib/rerank.ts` for prompt tuning. Add a
  fixture and a test in `test/fixtures/`.
- `src/app/api/<route>/route.ts` for new endpoints — model after `saved/`.
- `prisma/schema.prisma` for schema changes — REMEMBER to `npx prisma migrate
  dev --name <descriptive-name>` and commit both the schema and the migration.

## Testing strategy

- **Unit**: pure functions (`hash`, `location`, `company`, `tokens` sync).
- **Route**: full SSE-stream assertions with mocked Exa + DeepSeek (see
  `src/app/api/search/__tests__/route.test.ts`).
- **Visual**: not automated yet. Manual smoke test in light + dark mode at
  desktop + mobile breakpoints before any visual PR.
- **Integration with a real DB**: pending — see `docs/RELEASE.md`.

## Performance budget

- Median search end-to-end: **< 3 seconds**.
- p95 search end-to-end: **< 8 seconds**.
- Cache-hit search: **< 500ms**.
- Initial bundle: **< 200KB gzipped** (lazy-load modals and heavy widgets).
- LCP: **< 2.0s** on a desktop cold load.

Watch `EventLog.totalMs` for regressions.
