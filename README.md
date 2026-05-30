# OpenRoleKB

AI-powered job search in plain English. Type a sentence about the role you want and get relevant, live job postings ranked by an LLM.

## How it works

1. **Parse** — DeepSeek extracts structured filters from your natural language query (role, seniority, skills, location, remote, exclusions)
2. **Search** — Exa's neural web search finds job postings across greenhouse.io, lever.co, ashbyhq.com, and other ATS hosts
3. **Rerank** — DeepSeek scores all 25 results against your exact constraints; results below 40% match are filtered out
4. **Stream** — Results appear incrementally via Server-Sent Events as they arrive

Searches are cached in Postgres for 6 hours. Saved searches persist by anonymous browser ID — no account needed.

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Search**: Exa neural search API
- **LLM**: DeepSeek (OpenAI-compatible function calling)
- **Database**: Neon Postgres via Prisma 7
- **Fonts**: Fraunces (display), Geist Sans, Geist Mono

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
EXA_API_KEY=your-exa-key
DEEPSEEK_API_KEY=your-deepseek-key
DATABASE_URL=postgresql://...   # pooled connection string (runtime)
DIRECT_URL=postgresql://...     # direct connection (migrations)
```

Create the database tables:

```bash
npx prisma db push
```

## Running

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing Exa

```bash
npx tsx scripts/test-exa.ts "senior react engineer remote"
```

## Testing the query parser

```bash
npx tsx scripts/test-parse.ts
```

## Project structure

```
src/
  app/
    api/search/route.ts      # POST — SSE streaming pipeline
    api/saved/route.ts       # GET/POST/DELETE saved searches
    search/[id]/page.tsx     # Permalink to cached search results
  components/
    SearchBox.tsx             # Pill ask bar, We heard row, save button
    ResultsList.tsx           # Virtual-scroll list with keyboard nav
    ResultRow.tsx             # Compact result card
    DetailPane.tsx            # Job description detail view
    DetailSheet.tsx           # Mobile dialog wrapper
    ThemeToggle.tsx           # System/light/dark cycle
    SavedSearches.tsx         # Horizontal pill strip
    ScoreChip.tsx             # Tiered match % badge
    Skeleton.tsx              # Shimmer placeholder
    MascotSvg.tsx             # Line-art illustration
  lib/
    exa.ts                    # Exa client, ATS domain allowlist
    llm.ts                    # DeepSeek client (OpenAI SDK)
    parse-query.ts            # NL → structured filters
    rerank.ts                 # LLM rerank pass
    cache.ts                  # Prisma cache helpers
    company.ts                # Company name extraction from ATS URLs
    hash.ts                   # Query normalization + SHA-256
    prisma.ts                 # Singleton PrismaClient
    rate-limit.ts             # In-memory token bucket
prisma/
  schema.prisma               # Job, SearchCache, SavedSearch
  migrations/
```

## License

MIT
