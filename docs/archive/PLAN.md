# OpenRoleKB — Natural-Language Job Search

## Context

Greenfield build. The user wants a website where someone types a job query in natural language ("senior React role, remote-friendly, EU timezone, no crypto") and gets relevant live job postings. Searches are powered by Exa's neural web search; an LLM reranks results against the user's stated intent so the top of the list actually matches what they asked for. Results and saved searches are persisted in Postgres so repeat queries are fast and users can come back to a search later (no auth — saved searches keyed by an anonymous browser-side ID).

**Stack** (decided): Next.js App Router + TypeScript, hybrid Exa + LLM rerank, Postgres for cache & saved searches, no auth (MVP).

The repo is currently empty (`.git` + an unrelated `.commandcode/` folder only), so everything is built from scratch.

---

## Architecture

```
┌──────────────┐    ┌──────────────────────────────────────┐    ┌─────────┐
│  Next.js UI  │───▶│  /api/search  (route handler)        │───▶│  Exa    │
│  (RSC + CSR) │    │   1. parse NL → structured filters   │    │  API    │
│              │    │   2. check Postgres cache            │    └─────────┘
│              │    │   3. query Exa (neural, category=job)│         │
│              │    │   4. LLM rerank top N                │◀────────┘
│              │    │   5. persist + return                │
│              │◀───│                                      │
└──────────────┘    └──────────────────────────────────────┘
                                    │
                                    ▼
                             ┌──────────────┐
                             │  Postgres    │
                             │  (Prisma)    │
                             └──────────────┘
```

### Request flow (`POST /api/search`)
1. **Parse** — Send user's NL query to DeepSeek (`deepseek-chat`) via OpenAI-compatible tool-calling. Extract `{role, seniority, skills[], location, remote, salaryMin, exclude[], freshnessDays}`. Falls back to raw text if parse fails.
2. **Cache check** — Hash `(normalized_query, filters)` → look up `SearchCache` row younger than 6h. If hit, return immediately.
3. **Exa query** — Build a focused query string from extracted filters, call Exa `search_and_contents` with:
   - `type: "neural"`, `category: "job posting"`, `numResults: 25`
   - `includeDomains` favoring ATS hosts (greenhouse.io, lever.co, ashbyhq.com, workable.com, linkedin.com, …)
   - `startPublishedDate` from `freshnessDays`
   - `contents: { text: { maxCharacters: 2000 }, highlights: { numSentences: 3 } }`
4. **Rerank** — Send the 25 results (title + url + snippet) plus the original NL query to DeepSeek. Return ordered `{id, score 0–1, oneLineFit}`. Scores < 0.4 are dropped at read time. DeepSeek's automatic server-side context caching makes repeated rubric reuse fast — no client-side cache_control needed.
5. **Persist** — Upsert `Job` rows (dedupe by URL), insert `SearchCache` row.
6. **Respond** — Stream results to the client via Server-Sent Events so the user sees Exa hits immediately and rerank scores fill in as the LLM responds.

### Why hybrid rerank
Exa's neural search is strong at recall but mixes in stale postings, aggregators, and tangentially-matching pages. The LLM rerank pass cheaply enforces the user's actual constraints (seniority, exclusions, remote/location) that Exa can't strictly filter on.

---

## Data model (Prisma)

```prisma
model Job {
  id              String   @id @default(cuid())
  url             String   @unique
  title           String
  company         String?
  location        String?
  description     String?  // Exa text excerpt
  publishedAt     DateTime?
  source          String   // "greenhouse.io", etc.
  firstSeenAt     DateTime @default(now())
  lastSeenAt      DateTime @updatedAt
}

model SearchCache {
  id              String   @id @default(cuid())
  queryHash       String   @unique  // sha256(normalizedQuery + filters)
  rawQuery        String
  filters         Json
  resultJobIds    String[] // ordered
  rerankScores    Json     // { [jobId]: { score, fit } }
  createdAt       DateTime @default(now())
  @@index([createdAt])
}

model SavedSearch {
  id              String   @id @default(cuid())
  anonId          String   // localStorage UUID
  rawQuery        String
  filters         Json
  createdAt       DateTime @default(now())
  @@index([anonId])
}
```

`SearchCache` is purged by a daily cron (rows older than 7 days).

---

## File layout

```
package.json
next.config.ts
tsconfig.json
.env.example                    # EXA_API_KEY, DEEPSEEK_API_KEY, DATABASE_URL, DIRECT_URL
prisma/
  schema.prisma
  migrations/
src/
  app/
    layout.tsx
    page.tsx                    # search box + results list (RSC shell)
    search/[id]/page.tsx        # permalink to a cached search
    api/
      search/route.ts           # POST: streams SSE
      saved/route.ts            # GET/POST/DELETE
  components/
    SearchBox.tsx               # client component, calls /api/search
    JobCard.tsx
    ResultsStream.tsx           # consumes SSE
    SavedSearches.tsx
  lib/
    exa.ts                      # Exa client wrapper
    llm.ts                      # DeepSeek (OpenAI SDK) client singleton
    company.ts                  # URL → company name helper
    parse-query.ts              # NL → structured filters
    rerank.ts                   # LLM rerank pass
    cache.ts                    # Prisma cache helpers
    hash.ts                     # query normalization + sha256
    rate-limit.ts               # in-memory token-bucket rate limiter
    prisma.ts                   # PrismaClient singleton
  types/
    job.ts
```

---

## Key implementation notes

**`lib/exa.ts`** — Use the official `exa-js` SDK. One function: `searchJobs(query: string, filters: Filters): Promise<ExaResult[]>`. Hardcode the ATS allowlist. Map Exa results to a normalized shape.

**`lib/parse-query.ts`** — Single DeepSeek call via OpenAI-compatible API with `tools` / `tool_choice` for structured output. Tool schema mirrors the `Filters` type. Uses `deepseek-chat` — cheap, fast, plenty accurate for this. Timeout 4s; on failure return `{role: rawQuery}` so the search still runs.

**`lib/rerank.ts`** — Single DeepSeek call via OpenAI-compatible API. System prompt contains the rubric. User message contains the original NL query + a numbered list of `{idx, title, url, snippet}`. Function response: `[{idx, score, fit}]`. Uses `deepseek-chat` for cost. DeepSeek's automatic server-side context caching makes repeated rubric reuse fast.

**`api/search/route.ts`** — Returns `text/event-stream`. Events:
- `event: parsed` — extracted filters (so UI can show pills)
- `event: results` — raw Exa results (fast paint)
- `event: rerank` — final ordered list with scores
- `event: done`

**`SearchBox.tsx`** — Plain `<form>`, posts to `/api/search`, opens an `EventSource`-equivalent (fetch + ReadableStream, since EventSource doesn't support POST). Debounce not needed — only fires on submit.

**Saved searches** — On first visit, generate a UUID in `localStorage` (`openrolekb_anon_id`). Send it as a header. No PII.

**Rate limiting** — Simple in-memory token bucket per IP in the route handler (10 req/min). Good enough for MVP; revisit with Upstash later.

---

## Environment & deployment

`.env.example`:
```
EXA_API_KEY=
DEEPSEEK_API_KEY=
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...   # used by prisma.config.ts for migrations
```

Deploy target: Vercel (Next.js native) + a managed Postgres (Neon free tier is fine). The `/api/search` route runs on Node runtime (not Edge — Prisma needs Node).

---

## Build order

1. **Scaffold** — `npx create-next-app@latest` (App Router, TS, Tailwind), add Prisma, init Postgres schema, run first migration.
2. **Exa wrapper + smoke test** — `lib/exa.ts` + a one-off script that searches "senior react engineer remote" and prints results. Verify Exa returns useful job postings.
3. **NL parser** — `lib/parse-query.ts` with tool-use schema. Unit test against ~10 example queries.
4. **Search API (no rerank yet)** — `/api/search` returns raw Exa results as JSON (no streaming yet). Wire up `SearchBox` + `JobCard`. Get end-to-end working ugly.
5. **Caching** — Add `SearchCache` lookup/write around the Exa call.
6. **Rerank** — Add `lib/rerank.ts`. Compare top-5 before/after on the same query manually.
7. **SSE streaming** — Convert `/api/search` to stream events; convert `SearchBox` to consume the stream.
8. **Saved searches** — Anon ID in localStorage, `/api/saved` CRUD, `SavedSearches` component in the sidebar.
9. **Polish** — Filter pills (show what the LLM extracted), empty/error states, mobile layout, basic rate limiting.

Each step is independently testable; don't move on until the previous one works in the browser.

---

## Verification

- **Exa wrapper**: `npx tsx scripts/test-exa.ts "senior python remote"` prints ≥10 job results, all from ATS domains.
- **Parser**: `npx tsx scripts/test-parse.ts` — table of 10 NL queries → expected filters. Eyeball pass rate.
- **End-to-end**: `npm run dev`, search "junior frontend role in Berlin, no agencies, posted this month". Verify (a) filter pills show `location: Berlin`, `seniority: junior`, `freshnessDays: 30`, (b) results are dated within last 30 days, (c) top 3 are clearly Berlin-relevant.
- **Cache**: Run the same query twice — second response should be < 100ms and skip Exa (check server logs).
- **Saved search**: Save a query, reload page, confirm it appears in the sidebar; click → re-runs search.
- **Rerank quality check**: For 5 hand-picked queries, compare Exa raw top-5 vs reranked top-5; reranked should subjectively be better at least 4/5 times.

---

## Out of scope (explicit non-goals for MVP)

- Auth / accounts / email alerts
- Job board ingestion outside Exa
- Apply tracking, resume parsing
- Pagination beyond the first 25 Exa results (add later via Exa offsets)
- Mobile native app

- Pagination beyond the first 25 Exa results (add later via Exa offsets)
- Mobile native app
Mobile native app
