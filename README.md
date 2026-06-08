<div align="center">

<img src="public/mascot.svg" alt="OpenRoleKB" width="120" height="120" />

# OpenRoleKB

**Find a role you'll love — described in plain English.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/himanshu-nakrani/OpenRoleKB/actions/workflows/ci.yml/badge.svg)](https://github.com/himanshu-nakrani/OpenRoleKB/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

OpenRoleKB is an open-source, AI-powered job search engine. Type a sentence about the role you want — "senior product designer, remote US, early-stage startup" — and get live job postings scored by an LLM against your exact constraints. No boolean filters, no dropdowns, no keyword soup.

---

## Features

- **Natural language querying** — Gemini extracts structured filters (role, seniority, skills, location, salary, remote preference, exclusions, freshness) from whatever you type
- **Live neural search** — Exa crawls ATS career pages across greenhouse.io, lever.co, ashbyhq.com, workable, workday, smartrecruiters, bamboohr, recruitee, personio, teamtailor in real time
- **LLM reranking** — Every result is scored 0–100 against your full query; sub-40% matches are filtered out
- **6-hour caching** — Repeat queries skip the Exa + Gemini round trip
- **Anonymous-first** — No account required. Saved searches persist by browser ID. Sign in to sync across devices, or transfer with a one-time code from another device
- **Saved-search cadence** — Daily or weekly email digests for any saved search (`off` by default)
- **Email digests (Resend)** — A nightly cron re-runs opted-in saved searches and emails deltas of new postings
- **Server-Sent Events** — Results stream incrementally as they arrive
- **Dark mode** — System-aware light/dark/auto toggle
- **Saved searches** — Save any query in one click; re-run from the sidebar
- **Hide companies** — Never see a company again
- **Feedback loop** — Rate any result 👍/👎 to improve future rankings
- **Click tracking** — Outbound "Apply" links go through `/api/click` so we can measure click-through by query type
- **Dynamic OG cards** — `/api/og` renders title + company + score as a 1200×630 image for permalinks
- **Aurora theme** — Editorial landing, custom design tokens, Fraunces + Geist type stack
- **Structured observability** — Every search writes an `EventLog` row (latency, cost, cache hit, rerank success); Sentry captures errors with PII scrubbing

## How it works

```
User types query
      │
      ▼
┌──────────────┐     ┌──────────┐     ┌───────────┐
│  Gemini      │────▶│   Exa    │────▶│  Gemini    │
│  Parse to    │     │  Search  │     │  Rerank    │
│  filters     │     │  top 50  │     │  score 0-1 │
└──────────────┘     └──────────┘     └───────────┘
      │                    │                  │
      ▼                    ▼                  ▼
┌──────────────┐     ┌──────────┐     ┌───────────┐
│  SSE:parsed  │     │SSE:results│    │ SSE:rerank │
│  filters     │     │  jobs[]   │    │  scored[]  │
└──────────────┘     └──────────┘     └───────────┘
                           │                  │
                           ▼                  ▼
                     ┌──────────┐      ┌───────────┐
                     │ Postgres │◀─────│ Hide      │
                     │ Job rows │      │ companies │
                     └──────────┘      └───────────┘
                           │
                           ▼
                     ┌──────────┐
                     │ SSE:done │
                     │ cache id │
                     └──────────┘
```

## Quick start

```bash
git clone https://github.com/himanshu-nakrani/OpenRoleKB.git
cd OpenRoleKB
cp .env.example .env.local           # fill in EXA_API_KEY + GEMINI_API_KEY at minimum
npm install
npx prisma generate
npx prisma migrate dev               # needs a Postgres URL in DATABASE_URL
npm run dev                          # → http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000).

## Requirements

- **Node.js** ≥ 24 LTS
- **PostgreSQL** ≥ 15 (Neon serverless recommended)
- **Exa API key** — [exa.ai](https://exa.ai)
- **Gemini API key** — [Google AI Studio](https://aistudio.google.com/apikey)

### Optional services

| Service | Used for | Required? |
|---------|----------|-----------|
| Upstash Redis | Production rate limiting | No (falls back to in-memory) |
| Resend | Email magic-link auth | No (anonymous works) |
| Sentry | Error monitoring | No |

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `EXA_API_KEY` | Exa neural search API key |
| `GEMINI_API_KEY` | Google Gemini API key (OpenAI-compatible) |
| `DATABASE_URL` | Postgres pooled connection (runtime) |
| `DIRECT_URL` | Postgres direct connection (migrations) |
| `AUTH_SECRET` | NextAuth secret (`openssl rand -base64 32`) |
| `AUTH_URL` | Auth callback URL (default `http://localhost:3000`) |
| `RESEND_API_KEY` | Resend API key for magic-link emails |
| `RESEND_FROM` | Verified sender address in Resend |
| `CRON_SECRET` | Secret token for cron endpoints |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `SENTRY_DSN` | Sentry DSN for server-side error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for client-side error tracking |
| `SENTRY_AUTH_TOKEN` | Sentry auth token for sourcemap uploads |
| `NEXT_PUBLIC_SENTRY_RELEASE` | Release identifier (e.g., git SHA) |
| `NEXT_PUBLIC_SITE_URL` | Public site URL for absolute links (OG, sitemap) |
| `ADMIN_EMAIL` | Email for admin dashboard access |

### Optional services

| Service | Used for | Required? |
|---------|----------|-----------|
| Upstash Redis | Production rate limiting | No (falls back to in-memory) |
| Resend | Email magic-link auth + digests | No (anonymous works; digests disabled) |
| Sentry | Error monitoring | No |
| Vercel Analytics | Web Vitals + page views | No |
| Vercel Speed Insights | LCP/INP/CLS tracking | No |

## Usage

### Search

Type a query in natural language. Be specific — mention role, location, remote preference, tech stack, what to exclude. Examples:

- `senior react engineer, remote EU timezone, no crypto`
- `junior product manager, fintech, New York`
- `data engineer with dbt and snowflake, posted this month`
- `staff software engineer, Rust, remote, $200k+`

Use **⌘K** to focus the search bar from anywhere.

### Filter chips

The parsed filters appear as pills below the search bar. Click any pill to remove that constraint and re-search.

### Save a search

After running a query, click **Save this search**. Saved searches appear in the sidebar and persist across page refreshes.

### Hide a company

Click the **⋯** menu on any result card and choose **Hide company**. That company won't appear in future results.

### Feedback

Click 👍 or 👎 on any result to provide feedback on ranking quality.

### Permalinks

Every search result has a permalink at `/search/[id]` that you can bookmark or share.

## Project structure

```
src/
  app/
    api/search/route.ts              # POST — SSE streaming pipeline
    api/search/__tests__/            # Integration + contract + budget tests
    api/saved/route.ts               # GET/POST/DELETE saved searches
    api/saved/__tests__/             # Integration tests
    api/cron/
      cache-purge/route.ts           # Nightly cache TTL enforcement (2:05 AM UTC)
      saved-search-run/route.ts      # Cadence-triggered re-run + digest (2:17 PM UTC)
    api/click/route.ts               # 302 redirect with JobInteraction write
    api/transfer-code/route.ts       # Issue one-time cross-device transfer code
    api/transfer-code/redeem/route.ts# Consume transfer code, merge anon data
    api/og/route.tsx                 # Dynamic OG image (Edge runtime)
    api/hidden-companies/route.ts    # Hide-company CRUD
    api/interactions/route.ts        # Per-job saved/hidden/applied/dismissed
    api/feedback/route.ts            # Bad-match feedback events
    api/auth/merge/route.ts          # Anonymous → user account merge
    api/auth/[...nextauth]/route.ts  # NextAuth v5 (magic-link via Resend)
    api/me/saved-jobs/route.ts       # Signed-in user's saved jobs
    api/health/route.ts              # Liveness probe
    search/[id]/page.tsx             # Permalink to cached search results
    admin/health/page.tsx            # Telemetry dashboard
  components/
    SearchBox.tsx                    # Pill ask bar, filter chips, save button
    ResultsList.tsx                  # Virtual-scroll result list with keyboard nav
    ResultRow.tsx                    # Compact result card
    DetailPane.tsx                   # Job description detail view
    DetailSheet.tsx                  # Mobile dialog wrapper
    SavedSearches.tsx                # Horizontal pill strip + cadence dropdown
    ThemeToggle.tsx                  # System/light/dark cycle
    ScoreChip.tsx                    # Tiered match % badge
    SignInModal.tsx                  # Magic-link email auth dialog
    FeedbackModal.tsx                # Result rating dialog
    TransferCodeModal.tsx            # Anonymous-to-account data transfer
    LoadingNarrative.tsx             # "Parsing → Searching → Ranking" pipeline UI
    StillListedBadge.tsx             # Green "Still listed" badge on cache hits
    FreshnessPill.tsx                # Relative freshness ("2h ago", "3d ago")
    AtsStrip.tsx                     # ATS host badge (Greenhouse, Lever, etc.)
    DemoLoop.tsx                     # Home-page autoplay query carousel
    MascotSvg.tsx                    # OpenRoleKB mascot
    UserMenu.tsx                     # Signed-in avatar + sign out
    Skeleton.tsx                     # Loading placeholders
    Providers.tsx                    # Theme + Session + Analytics providers
  lib/
    exa.ts                           # Exa client with ATS domain allowlist
    llm.ts                           # Gemini client (OpenAI SDK)
    parse-query.ts                   # NL → structured filter extraction
    rerank.ts                        # LLM rerank pass with sanitization
    cache.ts                         # Postgres cache helpers
    company.ts                       # Company name extraction from ATS URLs
    hash.ts                          # Query normalization + SHA-256
    prisma.ts                        # Singleton PrismaClient
    rate-limit.ts                    # Upstash + in-memory rate limiter
    location.ts                      # Location and remote detection from job text
    owner.ts                         # User/anonymous identity resolution
    observe.ts                       # Error capture (console + Sentry)
    logger.ts                        # Structured JSON logs with PII scrubbing
    auth.ts                          # NextAuth configuration
    time.ts                          # Relative time formatter
    tokens.ts                        # Design tokens (palette/motion/type)
    motion.ts                        # JS-side motion helpers
    config.ts                        # Shared runtime config (model names, thresholds)
    salary.ts                        # Salary extraction + formatting
    transfer-code.ts                 # Transfer code generation + verification
  types/
    job.ts                           # Shared TypeScript types (Filters, ExaResult, RerankItem)
  hooks/
    useMergeOnSignIn.ts              # Auto-triggers anon→user merge
  emails/
    DigestEmail.tsx                  # React Email template for daily/weekly digest
prisma/
  schema.prisma                      # Database schema
  migrations/                        # SQL migrations applied in order
generated/prisma/                    # Generated client + types (committed)
scripts/
  eval.ts                            # Search-quality eval runner (live Exa + Gemini)
  eval-snapshot.ts                   # Eval snapshot management
  test-exa.ts                        # Manual Exa API test
  test-parse.ts                      # Manual query parser test
  ingest-greenhouse.ts               # Bulk ingest from Greenhouse boards
test/
  fixtures/                          # Exa and rerank mock response fixtures
  eval/
    golden-queries.json              # 20 hand-curated query → expected results
    score.ts                         # Rerank scoring logic
    snapshot-cache.ts                # Exa response snapshots for eval
    types.ts                         # Eval type definitions
```

## Testing

```bash
npm test                      # Run all tests (vitest)
npm run test:watch            # Watch mode
npm run test:coverage         # Coverage report
npm run test:contract         # Real-DB contract test (Postgres via testcontainers)
npm run eval                  # Search-quality eval (live Exa + Gemini)
npm run eval:dry              # Dry run — no API calls, synthetic rerank
npm run eval:snapshot         # Snapshot management utilities
```

Tests cover:
- **lib/** — company extraction, hash stability, location detection, rate limiting, tokens sync
- **api/search** — SSE event order, cache hit/miss, rerank failure fallback, Exa failure handling
- **api/search (contract)** — Real DB, real migrations, mocked Exa + Gemini; cache miss → write → cache hit
- **api/search (budget)** — Cost-per-search assertions against threshold
- **api/saved** — CRUD lifecycle for anonymous and signed-in users
- **eval/** — 20 golden queries; per-query pass/fail, aggregate pass rate, cost tracking

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Search API | Exa (neural web search) |
| LLM | Google Gemini Flash (`gemini-flash-latest`, OpenAI-compatible function calling) |
| Database | Neon Postgres (serverless) |
| ORM | Prisma 7 |
| Auth | NextAuth v5 (email magic-link via Resend) |
| Rate limiting | Upstash Redis |
| Monitoring | Sentry |
| Analytics | Vercel Speed Insights + Vercel Analytics |
| Email | Resend + React Email (DigestEmail.tsx) |
| Testing | Vitest + testcontainers (Postgres) |
| Fonts | Fraunces (display), Geist Sans, Geist Mono |

## Contributing

We welcome contributions of any size. Before opening a PR, please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, workflow, PR process
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- [ARCHITECTURE.md](./ARCHITECTURE.md) — codebase map for new contributors
- [SECURITY.md](./SECURITY.md) — how to disclose vulnerabilities

**Good first issues** are tagged [`good first issue`](https://github.com/himanshu-nakrani/OpenRoleKB/labels/good%20first%20issue).
**Larger features** are tagged [`help wanted`](https://github.com/himanshu-nakrani/OpenRoleKB/labels/help%20wanted).

Areas where help is especially welcome:

- **ATS parsers** — add company extraction for more hosts in `src/lib/company.ts`
- **Search quality** — improve the rerank rubric or query-parsing prompts
- **Accessibility** — keyboard navigation, screen-reader polish, contrast audits
- **Observability** — instrumentation, dashboards, alerting
- **i18n** — non-English UI and query support

## Roadmap

See [phase2.md](./phase2.md) for the detailed 4–6 week plan. High-level themes:

- **P0 — Foundation** — Real-DB contract test, Sentry verification, Web Vitals + bundle audit, lint clean
- **P1 — Retention loop** — Saved-search cadence (daily/weekly), cron re-run, email digest (Resend), cadence UI, telemetry
- **P2 — Search depth** — Multi-turn refinement ("too senior", "exclude crypto"), filter-chip-driven queries, job permalinks (`/job/[id]`), salary + location extraction
- **P3 — Trust + growth** — Privacy/Terms/About pages, trending searches widget, changelog page, SEO surface (robots.txt, sitemap.xml, JobPosting structured data)
- **P4 — Monetization preflight** — Cost model spreadsheet, daily budget alarms, tier definition doc, Stripe wiring (deferred)
- **P5 — Quality moat (ongoing)** — Rerank A/B harness, hidden-company feedback loop, click-through tracking, weekly internal digest

## License

Licensed under the [Apache License 2.0](./LICENSE).

Copyright © 2026 OpenRoleKB Contributors.

## Acknowledgements

- [Exa](https://exa.ai) for the neural search API
- [Google Gemini](https://ai.google.dev/) for LLM inference
- [Neon](https://neon.tech) for serverless Postgres
- [Vercel](https://vercel.com) for the Next.js framework + Analytics + Speed Insights
- [Upstash](https://upstash.com) for serverless Redis
- [Resend](https://resend.com) for email delivery
- [React Email](https://react.email/) for the digest email template
- [testcontainers](https://testcontainers.com/) for real-DB contract testing
