# FIXES

Action items from the code review, in suggested fix order. DeepSeek stays as the LLM provider — `PLAN.md` should be updated to reflect that (no prompt caching), but the implementation does not change.

---

## 1. Finish updating PLAN.md to reflect DeepSeek

**Status**: Lines 132 and 134 (the `lib/parse-query.ts` and `lib/rerank.ts` descriptions) have already been updated. The following stale Claude/Anthropic references remain:

| Line | Current | Change to |
|---|---|---|
| 34 | `Send user's NL query to Claude (`claude-haiku-4-5`) with a JSON schema.` | `Send user's NL query to DeepSeek (`deepseek-chat`) via OpenAI-compatible tool-calling.` |
| 41 | `Send the 25 results (title + url + snippet) plus the original NL query to Claude. … Use **prompt caching** on the system prompt (rerank rubric) — every search reuses the same rubric, so cache hit rate should be near 100%.` | `Send the 25 results (title + url + snippet) plus the original NL query to DeepSeek. Return ordered `{id, score 0–1, oneLineFit}`. Drop scores < 0.4. DeepSeek's automatic server-side context caching handles repeated rubric reuse — no client-side cache_control needed.` |
| 43 | `… as Claude responds.` | `… as the LLM responds.` |
| 97 | `# EXA_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL` | `# EXA_API_KEY, DEEPSEEK_API_KEY, DATABASE_URL, DIRECT_URL` |
| 116 | `anthropic.ts                # Anthropic client (singleton)` | `llm.ts                      # DeepSeek (OpenAI SDK) client singleton` |
| 155 | `ANTHROPIC_API_KEY=` | `DEEPSEEK_API_KEY=` |

Also add `DIRECT_URL=` to the `.env.example` block in PLAN.md — it's used by `prisma.config.ts` and is present in the real `.env.example`.

No code changes.

---

## 2. Add "Save this search" button (BLOCKER)

**Problem**: `SavedSearches.tsx` reads `GET /api/saved` and renders the list, but nothing in the UI calls `POST /api/saved`. The sidebar is permanently empty in practice.

**Where**: `src/components/SearchBox.tsx`

**Implementation**:

1. After a successful search (when `state.phase === "idle"` AND `state.exaResults.length > 0`), show a "Save search" button next to the filter pills.
2. On click, `POST /api/saved` with `{ rawQuery: query, filters: state.filters }` and the `x-anon-id` header.
3. Notify `SavedSearches` to refetch — simplest mechanism: a custom event.

```tsx
// In SearchBox.tsx, after successful save:
window.dispatchEvent(new CustomEvent("openrolekb:saved-changed"));
```

```tsx
// In SavedSearches.tsx, inside useEffect:
useEffect(() => {
  loadSearches();
  const handler = () => loadSearches();
  window.addEventListener("openrolekb:saved-changed", handler);
  return () => window.removeEventListener("openrolekb:saved-changed", handler);
}, [loadSearches]);
```

4. Track saved state per-query so the button can flip to "Saved ✓" and not double-insert. Or accept duplicates and rely on the user being sensible — MVP either is fine.

**Verify**: Search a query, click Save, reload the page → query appears in the sidebar.

---

## 3. Return real cacheId from `cacheSearch()` and wire it into `done` (BLOCKER)

**Problem**: `route.ts:82` declares `let cacheId: string | null = null` and never assigns it. `send("done", { id: cacheId })` always sends `null`, so the `/search/[id]` permalink page is unreachable from the client.

**Where**: `src/lib/cache.ts` and `src/app/api/search/route.ts`

**Implementation**:

`cache.ts` — return the cache id:

```ts
export async function cacheSearch(...): Promise<string> {
  // ... existing code ...
  const cache = await prisma.searchCache.upsert({
    where: { queryHash },
    create: { ... },
    update: { ... },
  });
  return cache.id;
}
```

`route.ts:82-88` — capture and send it:

```ts
let cacheId: string | null = null;
try {
  cacheId = await cacheSearch(rawQuery, filters, exaResults, rerankScores);
} catch {
  // cache write failure is non-fatal
}
send("done", { id: cacheId });
```

Also update the cache-hit branch (`route.ts:62`) — it already sends `cached.cache.id` correctly, no change needed there.

**Verify**: Search a query, check the network tab for the `done` event — `data` should contain a non-null `id`. Visit `/search/<that-id>` and confirm the page renders.

---

## 4. Fix cache replay / rerank score mismatch (BLOCKER)

**Problem**: `rerank.ts:71` drops scores < 0.4 before returning. `route.ts:74-76` only writes `rerankScores` for the surviving (kept) ids. But `cacheSearch` still upserts **all 25** exa results into `resultJobIds`. On cache replay (`route.ts:55-60`), every dropped job gets the `0.5` fallback score and re-appears with a fake "Relevance not rated" label.

**Two ways to fix — pick one.**

### Option A: Cache only the kept results (recommended)

This is the cleaner model — what's cached is what was shown.

`route.ts:73-87`:

```ts
let reranked: RerankItem[] = [];
let rerankScores: Record<string, { score: number; fit: string }> = {};
let keptResults: ExaResult[] = exaResults;
try {
  reranked = await rerank(rawQuery, exaResults);
  const keptIdxSet = new Set(reranked.map((r) => r.idx));
  keptResults = exaResults.filter((_, i) => keptIdxSet.has(i));
  // Rebuild reranked indices to refer to keptResults positions
  reranked = reranked.map((r, newIdx) => ({ ...r, idx: newIdx }));
  rerankScores = Object.fromEntries(
    reranked.map((r) => [keptResults[r.idx].id, { score: r.score, fit: r.fit }]),
  );
} catch {
  reranked = exaResults.map((_, i) => ({ idx: i, score: 0.5, fit: "" }));
}
send("rerank", reranked);

try {
  cacheId = await cacheSearch(rawQuery, filters, keptResults, rerankScores);
} catch {}
```

Note: this also requires sending `keptResults` to the client in the `results` event *if* you want the SSE order to match. Simpler: keep `results` as the full 25, and let `rerank` indices refer to those (no index rebuild). Then in `cacheSearch`, pass `keptResults` so the cache only stores survivors. The trade-off: client sees the full 25 briefly until rerank arrives, then collapses to survivors. That's already the current UX.

### Option B: Persist all scores including <0.4, filter on read

Change `rerank.ts:71`:
```ts
return rated.results.sort((a, b) => b.score - a.score);
```

Then in `route.ts` (cache-hit branch and fresh branch), filter `score >= 0.4` after reading from cache. The cache becomes a faithful snapshot; clients always see the threshold applied.

This is less invasive — recommend Option B if you want to minimize changes.

**Verify**: Run the same query twice. Second run should be < 100ms (cache hit, look for absence of Exa logs) and show the **exact same** result list with the **exact same** scores as the first run.

---

## 5. ATS allowlist contains path segments — Exa expects domains

**Problem**: `lib/exa.ts:9` has `"linkedin.com/jobs"`. Exa's `includeDomains` is a domain filter, not a URL prefix filter. This entry matches nothing or is silently dropped.

**Where**: `src/lib/exa.ts:4-18`

**Fix**:
- Replace `"linkedin.com/jobs"` → `"linkedin.com"`.
- Optionally post-filter results so LinkedIn URLs without `/jobs/` in the path are dropped:

```ts
return response.results
  .filter((r: any) => {
    if (r.url.includes("linkedin.com") && !r.url.includes("/jobs/")) return false;
    return true;
  })
  .map(...);
```

**Verify**: Run `npx tsx scripts/test-exa.ts "senior react remote"`. LinkedIn results should appear and all should have `/jobs/` in the path.

---

## 6. Drop `useAutoprompt` OR drop the hand-built query string

**Problem**: `lib/exa.ts:57` sets `useAutoprompt: true` while `buildQueryString` constructs a structured query with `-exclusions`. With autoprompt on, Exa rewrites the query and your `-foo -bar` exclusions are likely discarded. Pick one source of truth.

**Where**: `src/lib/exa.ts:33-48, 57`

**Recommendation**: Drop `useAutoprompt` (`useAutoprompt: false` or just remove the line — false is default). You're already doing the "prompt engineering" job by structuring the query from parsed filters. Autoprompt is for raw natural-language queries.

**Verify**: Re-run `scripts/test-exa.ts` with a query containing an exclusion (e.g. add `-crypto` manually to a `buildQueryString` test) — confirm crypto-related jobs are absent from results, or substantially fewer than without the exclusion.

---

## 7. Extract company from URL instead of `r.author`

**Problem**: `cache.ts:44, 53` uses `r.author` as the `company` column. Exa's `author` field is rarely the employer for ATS results — for greenhouse/lever the company is in the URL.

**Where**: `src/lib/cache.ts` (new helper, plus replace `r.author` usages)

**Implementation**:

Add a helper in `src/lib/exa.ts` (or a new `src/lib/company.ts`):

```ts
export function extractCompany(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.split("/").filter(Boolean);

    // Greenhouse: job-boards.greenhouse.io/{company}/jobs/...
    //             boards.greenhouse.io/{company}/jobs/...
    if (host.endsWith("greenhouse.io") && path[0]) return path[0];

    // Lever: jobs.lever.co/{company}/...
    if (host === "jobs.lever.co" && path[0]) return path[0];

    // Ashby: jobs.ashbyhq.com/{company}/...
    if (host === "jobs.ashbyhq.com" && path[0]) return path[0];

    // Workable: apply.workable.com/{company}/j/...
    if (host === "apply.workable.com" && path[0]) return path[0];

    // Wellfound: wellfound.com/jobs/{id}-{title}-at-{company}  — skip, too unreliable

    // Otta: otta.com/jobs/{id} — company is in the page, not the URL

    return null;
  } catch {
    return null;
  }
}
```

Then in `cache.ts:44, 53`:
```ts
company: extractCompany(r.url),
```

**Verify**: Run a search, query the DB: `SELECT title, company, source FROM "Job" LIMIT 20;`. Greenhouse/Lever/Ashby/Workable rows should have populated `company`. Others can stay null.

---

## 8. Add `X-Accel-Buffering: no` to SSE response

**Problem**: `route.ts:97-103` — behind some proxies (including Vercel's default for Node functions), SSE responses buffer until the stream closes. The user sees nothing until everything is done.

**Where**: `src/app/api/search/route.ts:97-103`

**Fix**:
```ts
return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  },
});
```

(Added `no-transform` to `Cache-Control` to prevent gzip middleware from buffering for compression.)

**Verify**: Deploy to Vercel preview, run a search, watch the network tab — `parsed` and `results` events should arrive before `rerank` (visible as separate ticks).

---

## 9. Rate limiter refill math discards leftover time

**Problem**: `lib/rate-limit.ts:21-25`: when refilling, sets `lastRefill = now` instead of `lastRefill += refillWindows * WINDOW_MS`. Effective rate drifts below the configured limit.

**Where**: `src/lib/rate-limit.ts:21-25`

**Fix**:
```ts
const elapsed = now - bucket.lastRefill;
const windows = Math.floor(elapsed / WINDOW_MS);
if (windows > 0) {
  bucket.tokens = Math.min(MAX_REQUESTS, bucket.tokens + windows * MAX_REQUESTS);
  bucket.lastRefill += windows * WINDOW_MS;
}
```

Minor — doesn't affect MVP correctness, but easy to fix while you're here.

---

## 10. Lint cleanup (12 errors + 3 warnings)

Run `npx eslint . --fix` first to auto-fix what's possible, then handle the rest manually.

### 10a. `no-explicit-any` (7 occurrences)

| File | Fix |
|---|---|
| `lib/exa.ts:72` | `params as any` → drop the `as any`. Exa's type allows `Record<string, unknown>` constructor. If types don't match, define a local `ExaSearchParams` type. |
| `lib/exa.ts:76` | `(r: any)` → import `ExaResult` from `exa-js` and use that, or define a minimal `interface RawExaResult { id: string; title?: string; url: string; text?: string; highlights?: string[]; publishedDate?: string; author?: string; }`. |
| `lib/cache.ts:66,68,72,74` | `as any` on Prisma `Json` columns → cast to `Prisma.InputJsonValue` from the generated client, or use `JSON.parse(JSON.stringify(filters))` if the type fights you. |
| `lib/prisma.ts:24` | `(getPrisma() as any)[prop]` → `Reflect.get(getPrisma(), prop)` then cast the return through `unknown`. Or just suppress this one with a comment — proxies and TS are a known dance. |
| `components/SearchBox.tsx:94` | `data: any` in `handleSSEEvent` → type as `unknown` and narrow per branch, or define a `SSEEventData` union. |

### 10b. `react-hooks/set-state-in-effect` — `SavedSearches.tsx:38`

This rule (React 19) wants you to either:
- Use a data-fetching hook (`useSWR` / `useQuery`), or
- Guard against double-invocation in strict mode with a ref:

```ts
const fetchedRef = useRef(false);
useEffect(() => {
  if (fetchedRef.current) return;
  fetchedRef.current = true;
  loadSearches();
}, [loadSearches]);
```

Simplest path for MVP: add the ref guard and the event listener from fix #2 above.

### 10c. `no-html-link-for-pages` — `search/[id]/page.tsx:27`

```diff
- <a href="/" className="text-sm text-blue-600 hover:underline">
+ <Link href="/" className="text-sm text-blue-600 hover:underline">
```

Add `import Link from "next/link";` at the top.

### 10d. Unused vars

- `SearchBox.tsx:23` — delete `inputRef`. It's created but never attached. (Or attach `ref={inputRef}` to the input and use it to focus on mount: `useEffect(() => inputRef.current?.focus(), [])`.)
- `search/[id]/page.tsx:39` — rename `i` to `_i` or destructure without it: `cached.resultJobIds.map((jobId) => { ... })`.

**Verify**: `npx eslint .` exits 0.

---

## Out-of-scope reminders (don't fix now)

- **Cache purge cron** — plan says "later". Add when cache table grows past ~10k rows.
- **Pagination beyond 25 Exa results** — defer.
- **Auth** — out of scope for MVP.

---

## Suggested commit order

Each fix is independently testable. Suggested grouping for clean commits:

1. `docs: update PLAN to reflect DeepSeek` (#1)
2. `fix(search): return cacheId and wire into done event` (#3)
3. `fix(cache): persist all rerank scores; filter on read` (#4 option B)
4. `feat(ui): add save search button + refresh sidebar on save` (#2)
5. `fix(exa): drop linkedin path, disable useAutoprompt, extract company from URL` (#5, #6, #7)
6. `fix(api): add X-Accel-Buffering header; correct rate-limit refill` (#8, #9)
7. `chore: resolve lint errors` (#10)
