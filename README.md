<div align="center">

<img src="public/mascot.svg" alt="OpenRoleKB" width="120" height="120" />

# OpenRoleKB

**Find a role you'll love — described in plain English.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-61%20passed-green)]()

</div>

OpenRoleKB is an open-source, AI-powered job search engine. Type a sentence about the role you want — "senior product designer, remote US, early-stage startup" — and get live job postings scored by an LLM against your exact constraints. No boolean filters, no dropdowns, no keyword soup.

---

## Features

- **Natural language querying** — DeepSeek extracts structured filters (role, seniority, skills, location, salary, remote preference, exclusions, freshness) from whatever you type
- **Live neural search** — Exa crawls ATS career pages across greenhouse.io, lever.co, ashbyhq.com, and 7 other hosts in real time
- **LLM reranking** — Every result is scored 0–100 against your full query; sub-40% matches are filtered out
- **6-hour caching** — Repeat queries skip the Exa + DeepSeek round trip
- **Anonymous-first** — No account required. Saved searches persist by browser ID. Sign in to sync across devices.
- **Server-Sent Events** — Results stream incrementally as they arrive
- **Dark mode** — System-aware light/dark/auto toggle
- **Saved searches** — Save any query in one click; re-run from the sidebar
- **Hide companies** — Never see a company again
- **Feedback loop** — Rate any result 👍/👎 to improve future rankings

## How it works

```
User types query
      │
      ▼
┌──────────────┐     ┌──────────┐     ┌───────────┐
│  DeepSeek    │────▶│   Exa    │────▶│  DeepSeek  │
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
npm install
cp .env.example .env
# Fill in EXA_API_KEY, DEEPSEEK_API_KEY, DATABASE_URL, DIRECT_URL
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Requirements

- **Node.js** ≥ 20
- **PostgreSQL** (Neon serverless recommended)
- **Exa API key** — [exa.ai](https://exa.ai)
- **DeepSeek API key** — [deepseek.com](https://deepseek.com)

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
| `DEEPSEEK_API_KEY` | DeepSeek API key (OpenAI-compatible) |
| `DATABASE_URL` | Postgres pooled connection (runtime) |
| `DIRECT_URL` | Postgres direct connection (migrations) |
| `AUTH_SECRET` | NextAuth secret (`openssl rand -base64 32`) |
| `AUTH_URL` | Auth callback URL (default `http://localhost:3000`) |
| `RESEND_API_KEY` | Resend API key for magic-link emails |
| `RESEND_FROM` | Verified sender address in Resend |
| `CRON_SECRET` | Secret token for cron endpoint |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `SENTRY_DSN` | Sentry DSN for error tracking |
| `ADMIN_EMAIL` | Email for admin access |

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
    api/search/route.ts          # POST — SSE streaming pipeline
    api/saved/route.ts           # GET/POST/DELETE saved searches
    api/search/__tests__/        # Integration tests
    api/saved/__tests__/         # Integration tests
    search/[id]/page.tsx         # Permalink to cached search results
    admin/health/page.tsx        # Telemetry dashboard
  components/
    SearchBox.tsx                # Pill ask bar, filter chips, save button
    ResultsList.tsx              # Virtual-scroll result list with keyboard nav
    ResultRow.tsx                # Compact result card
    DetailPane.tsx               # Job description detail view
    DetailSheet.tsx              # Mobile dialog wrapper
    SavedSearches.tsx            # Horizontal pill strip
    ThemeToggle.tsx              # System/light/dark cycle
    ScoreChip.tsx                # Tiered match % badge
    SignInModal.tsx              # Magic-link email auth dialog
    FeedbackModal.tsx            # Result rating dialog
    TransferCodeModal.tsx        # Anonymous-to-account data transfer
  lib/
    exa.ts                       # Exa client with ATS domain allowlist
    llm.ts                       # DeepSeek client (OpenAI SDK)
    parse-query.ts               # NL → structured filter extraction
    rerank.ts                    # LLM rerank pass with sanitization
    cache.ts                     # Postgres cache helpers
    company.ts                   # Company name extraction from ATS URLs
    hash.ts                      # Query normalization + SHA-256
    prisma.ts                    # Singleton PrismaClient
    rate-limit.ts                # Upstash + in-memory rate limiter
    location.ts                  # Location and remote detection from job text
    owner.ts                     # User/anonymous identity resolution
    observe.ts                   # Error capture (console + Sentry)
    auth.ts                      # NextAuth configuration
    time.ts                      # Relative time formatter
  types/
    job.ts                       # Shared TypeScript types
prisma/
  schema.prisma                  # Database schema
scripts/
  test-exa.ts                    # Manual Exa API test
  test-parse.ts                  # Manual query parser test
test/
  fixtures/                      # Exa and rerank mock response fixtures
```

## Testing

```bash
npm test                    # Run all tests (vitest)
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```

Tests cover:
- **lib/** — company extraction, hash stability, location detection, rate limiting
- **api/search** — SSE event order, cache hit/miss, rerank failure fallback, Exa failure handling
- **api/saved** — CRUD lifecycle for anonymous and signed-in users

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Search API | Exa (neural web search) |
| LLM | DeepSeek (OpenAI-compatible function calling) |
| Database | Neon Postgres (serverless) |
| ORM | Prisma 7 |
| Auth | NextAuth v5 (email magic-link via Resend) |
| Rate limiting | Upstash Redis |
| Monitoring | Sentry |
| Testing | Vitest |
| Fonts | Fraunces (display), Geist Sans, Geist Mono |

## Contributing

Contributions are welcome. Areas that could use help:

- **ATS parsers** — Add company extraction for new ATS hosts in `src/lib/company.ts`
- **Search quality** — Improve the LLM rerank rubric or query parsing prompts
- **Client-side UX** — Virtual scroll improvements, accessibility, animations
- **Observability** — Instrumentation, dashboards, alerting
- **Multilingual** — i18n for the UI and non-English query support

Before opening a PR:
1. Run `npm test` and make sure all tests pass
2. Run `npm run lint` and fix any issues
3. Add tests for new behavior

## License

MIT © OpenRoleKB

## Acknowledgements

- [Exa](https://exa.ai) for the neural search API
- [DeepSeek](https://deepseek.com) for cost-effective LLM inference
- [Neon](https://neon.tech) for serverless Postgres
- [Vercel](https://vercel.com) for the Next.js framework
- [Upstash](https://upstash.com) for serverless Redis
- [Resend](https://resend.com) for email delivery
