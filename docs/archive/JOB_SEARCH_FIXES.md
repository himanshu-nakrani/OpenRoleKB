# Job Search — Fix Prompt

Self-contained instructions to fix every bug surfaced in the review of the search path
(`/api/search` → `lib/exa` → `lib/rerank` → `lib/cache` → UI). Each item is independently
actionable: file path, exact lines, root cause, required change, and acceptance criteria.

Work top-to-bottom. The ordering reflects dependency + blast radius — earlier items unblock
later ones and prevent re-introducing bugs.

> Conventions used below
> - **File:** absolute path inside the repo.
> - **Lines** refer to the file state at HEAD as of 2026-06-01.
> - **Acceptance** is the minimum verification the change is correct. Run `npm test` after
>   each change and confirm `vitest run` still passes.
> - Do not introduce new abstractions unless the fix requires it.
> - Do not add comments explaining the fix. Code + tests are the explanation.

---

## P0 — Correctness (must fix before anything else)

### F1. Persist saved searches against `userId` for signed-in users

**File:** `src/app/api/saved/route.ts`
**Lines:** 18–22, 47–54, 77–83
**Files also touched:** `src/lib/owner.ts`, `prisma/schema.prisma`, `src/components/SavedSearches.tsx`

**Root cause.** `getOwnerKey` returns either a NextAuth `user.id` (cuid) or an anonymous
UUID. Today every saved-search query stores and reads it as `anonId`. Signed-in users:
- POST writes `{anonId: <userId>, userId: null}` — so the `@@unique([userId, queryHash])`
  constraint is never exercised.
- GET filters `where: { anonId: ownerKey }` — never returns a record whose `userId`
  matches.
- DELETE check `saved.anonId !== ownerKey` fails for any record correctly keyed by user.

**Change.**

1. Change `getOwnerKey` to also tell callers which kind of key it returned. Either return
   a tagged object `{ kind: 'user' | 'anon', key: string }` or expose a sibling helper
   `getOwnerIdentity(req)` and keep `getOwnerKey` for the rate-limit path (which doesn't
   care about the distinction).

2. In `POST /api/saved`:
   - If `identity.kind === 'user'`: `data: { userId: identity.key, queryHash, rawQuery, filters }`
   - If `identity.kind === 'anon'`: `data: { anonId: identity.key, queryHash, rawQuery, filters }`
   - Use `prisma.savedSearch.upsert` rather than `create` so re-saving the same search is
     idempotent. Compose the `where` clause from whichever unique constraint applies
     (`{userId_queryHash: …}` for users, see F9 for the new anon constraint).

3. In `GET /api/saved`:
   - `where: identity.kind === 'user' ? { userId: identity.key } : { anonId: identity.key }`

4. In `DELETE /api/saved`:
   - Replace the two-step find-then-delete with a single
     `prisma.savedSearch.deleteMany({ where: { id, ...identityFilter } })` and treat
     `count === 0` as 404. Closes the timing channel as a small bonus.

5. `src/components/SavedSearches.tsx` keeps the same API surface — no changes if your
   request shape didn't change.

**Acceptance.**
- A signed-in user can POST a saved search, see it via GET, and DELETE it.
- An anonymous user with the same query as a signed-in user gets two distinct rows.
- Saving the same `{rawQuery, filters}` twice for the same identity returns 200 (upsert),
  not a 500/409.
- Existing `src/app/api/saved/__tests__/route.test.ts` still passes (add cases for the
  signed-in path).

---

### F2. Apply hide-company filter on cache hits

**File:** `src/app/api/search/route.ts`
**Lines:** 66–86 (cache-hit branch).

**Root cause.** The cache-hit branch returns `cached.jobs` + the stored rerank list
directly. The `HiddenCompany` lookup only runs in the cache-miss branch (109–121). Users
who hide a company see it again whenever the query is cache-hot.

**Change.** Extract the hide-company filter into a helper and call it from both branches.

```ts
async function applyHiddenCompanies(
  ownerKey: string | null,
  reranked: RerankItem[],
  results: Array<{ url: string }>,
): Promise<RerankItem[]> {
  if (!ownerKey) return reranked;
  const hidden = await prisma.hiddenCompany.findMany({
    where: { ownerKey },
    select: { company: true },
  });
  if (!hidden.length) return reranked;
  const hiddenSet = new Set(hidden.map((h) => h.company.toLowerCase()));
  return reranked.filter((r) => {
    const company = extractCompany(results[r.idx]?.url ?? '')?.toLowerCase();
    return !company || !hiddenSet.has(company);
  });
}
```

Use it before `send("rerank", reranked)` in both branches. In the cache-hit branch, pass
`cached.jobs.map(j => ({url: j.url}))` (after F3 has normalized shape).

**Acceptance.**
- Hide a company, run a query so it hits cache, confirm the hidden company is absent
  from the `rerank` SSE event.
- Cache-hit and cache-miss paths return the same filtered set for the same hidden list.

---

### F3. Normalize cache-hit `results` event to `ExaResult` shape

**File:** `src/app/api/search/route.ts`, line 70.
**File:** `src/lib/cache.ts`, lines 20–29.

**Root cause.** `send("results", cached.jobs)` ships Prisma `Job` rows (`publishedAt`,
`description`, no `highlights`). The UI expects `ExaResult` (`publishedDate`, `text`,
`highlights`). On cache hit:
- `ResultsList.tsx:139` shows no dates (`publishedDate` is undefined on every row).
- "Newest" sort silently treats every row as undated.
- `DetailPane` / `DetailSheet` render with empty body text.

**Change.** Adapt cached jobs back into the wire shape inside `getCachedSearch`:

```ts
type CachedJob = {
  id: string;
  title: string;
  url: string;
  text: string;
  highlights: string[];
  publishedDate?: string;
  author?: string;
};

// ...inside getCachedSearch, after findMany:
const jobs: CachedJob[] = cached.resultJobIds
  .map((id) => jobMap.get(id))
  .filter((j): j is NonNullable<typeof j> => Boolean(j))
  .map((j) => ({
    id: j.id,
    title: j.title,
    url: j.url,
    text: j.description ?? '',
    highlights: [], // not persisted; client tolerates empty
    publishedDate: j.publishedAt?.toISOString(),
    author: undefined,
  }));
```

Also update the return so the route's `cached.jobs` is the adapted array (not Prisma
rows).

**Acceptance.**
- Trigger a cache hit. In dev tools, the `data:` payload for the first `results` SSE
  event has `publishedDate` and `text` keys.
- The "Newest" sort behaves identically on cache-hit and cache-miss.
- `DetailPane` shows the description on a cache-hit selection.

---

### F4. Don't cache when rerank falls back

**File:** `src/app/api/search/route.ts`, lines 94–132.

**Root cause.** When `rerank()` throws, `rerankScores` stays `{}`. The route still calls
`cacheSearch(...)` (line 128), persisting a row whose stored scores are all missing. On
every cache hit for the next 6 hours, `scores[id]?.score ?? 0.5` returns `0.5` for every
item, the `>= 0.4` filter keeps everything, and the user sees an unranked dump. The cache
poisons itself.

**Change.** Track a `rerankFailed` boolean. If true, skip `cacheSearch` entirely, and
include the flag in the EventLog row (add a `rerankFailed Boolean @default(false)` column
to `EventLog` in `prisma/schema.prisma` and migrate).

```ts
let rerankFailed = false;
try {
  // ... rerank + filter
} catch (err) {
  rerankFailed = true;
  captureRouteError(err, { ... });
  reranked = exaResults.map((_, i) => ({ idx: i, score: 0.5, fit: '' }));
}

// later:
let cacheId: string | null = null;
if (!rerankFailed) {
  try { cacheId = await cacheSearch(...); } catch (err) { ... }
}
send('done', { id: cacheId });
```

**Acceptance.**
- Force `rerank()` to throw (mock in tests). Confirm `SearchCache` has no new row for
  that query hash, while the SSE stream still completes with the 0.5-fallback rerank list.
- `EventLog` row for that request has `rerankFailed=true`.

---

### F5. Drop missing job IDs from the cache-hit rerank list

**File:** `src/lib/cache.ts`, lines 20–29.
**File:** `src/app/api/search/route.ts`, lines 71–78.

**Root cause.** `findMany({where: {id: {in: resultJobIds}}})` returns only existing jobs.
`.filter(Boolean)` drops the missing ones, but the route builds the rerank list from the
**original** `cached.cache.resultJobIds` (line 72) which still includes the missing IDs.
Net effect: the rerank `idx` numbers point past the end of `cached.jobs` on the client and
render empty rows.

**Change.** Build both arrays from the same filtered set:

```ts
// inside getCachedSearch:
const ordered = cached.resultJobIds
  .map((id) => jobMap.get(id))
  .filter((j): j is NonNullable<typeof j> => Boolean(j));

return {
  cache: cached,
  jobs: ordered.map(adaptToExaShape),
  resultJobIds: ordered.map((j) => j.id), // <-- expose this
};
```

In the route:

```ts
const reranked: RerankItem[] = cached.resultJobIds.map((id, i) => ({
  idx: i,
  score: scores[id]?.score ?? 0.5,
  fit: scores[id]?.fit ?? '',
})).filter((r) => r.score >= 0.4);
```

Use the new `cached.resultJobIds` (filtered to present jobs), not `cached.cache.resultJobIds`.

**Acceptance.**
- Delete a job referenced by an existing `SearchCache` row, then re-run the same query.
  Client receives a `results` array and a `rerank` array of identical length, no empty
  rows in the UI.

---

### F6. Handle aggregator domains in `extractCompany` (or stop searching them)

**File:** `src/lib/company.ts`
**File:** `src/lib/exa.ts`, lines 4–24.

**Root cause.** Half the domains in `ATS_DOMAINS` (linkedin, indeed, glassdoor,
ziprecruiter, dice, simplify, wellfound, builtin, otta) never produce a non-null
company. Knock-on effects:
- `HiddenCompany` filter never matches a job sourced from these sites — users cannot hide
  a company that appears via LinkedIn.
- `ResultsList` shows the row but the company column is blank or falls back to
  `r.author` (which from Exa is rarely the company name).

**Change.** Pick one of:

**Option A (recommended for v1):** Remove aggregators from `ATS_DOMAINS` entirely. Exa
already deep-crawls company career pages on ATS hosts, so the aggregator coverage is
duplicate and lower quality. Keep only the direct ATS hosts: `greenhouse.io`, `lever.co`,
`ashbyhq.com`, `workable.com`, `myworkdayjobs.com`, `smartrecruiters.com`, `bamboohr.com`,
`recruitee.com`, `personio.de`, `teamtailor.com`.

**Option B:** Add parsers for the aggregators where the URL has a stable company segment:
- `linkedin.com/jobs/view/<id>` — company is in the page title; not derivable from URL.
- `indeed.com/cmp/<company>/jobs` — `path[1]` after `/cmp/`.
- `glassdoor.com/job-listing/...-at-<company>-...` — slug-suffix parse.

If you go with Option B, add tests in `src/lib/__tests__/company.test.ts` for every new
host.

**Acceptance.**
- After change, no domain in `ATS_DOMAINS` returns null from `extractCompany` for a
  representative URL.
- `HiddenCompany` round-trip works for every domain shipped to the client.

---

### F7. Correct `exaMs` label on cache-hit logging

**File:** `src/app/api/search/route.ts`, line 84.

**Root cause.** On a cache hit, the metric stored as `exaMs` is actually
`performance.now() - tCacheCheck`, i.e. the cache-fetch time. Misleads dashboards.

**Change.** On cache hit, log `exaMs: 0` and add a new metric `cacheMs` for the cache
lookup duration. Add the column to `EventLog` (`cacheMs Int? @default(0)`).

**Acceptance.**
- A cache-hit `EventLog` row has `exaMs: 0` and `cacheMs > 0`.
- A cache-miss row has `exaMs > 0` and `cacheMs: 0` (or omitted).

---

### F8. Fail the save UI when the request fails

**File:** `src/components/SearchBox.tsx`, lines 162–176.

**Root cause.** `await fetch(...)` then unconditional `setSaved(true)`. 4xx/5xx still
flips the button to "Saved ✓".

**Change.**

```ts
async function handleSave() {
  try {
    const res = await fetch('/api/saved', { ... });
    if (!res.ok) {
      setState((s) => ({ ...s, error: 'Couldn’t save this search.' }));
      return;
    }
    setSaved(true);
    window.dispatchEvent(new CustomEvent('openrolekb:saved-changed'));
  } catch {
    setState((s) => ({ ...s, error: 'Network error while saving.' }));
  }
}
```

**Acceptance.**
- Force `/api/saved` POST to return 500. Button does not flip to "Saved ✓"; error message
  is visible.

---

### F9. Anonymous-saved-search dedupe constraint

**File:** `prisma/schema.prisma`, `SavedSearch` model.

**Root cause.** Only `@@unique([userId, queryHash])` exists. Anonymous users can save the
same search any number of times.

**Change.** Add `@@unique([anonId, queryHash])`. Generate a migration:

```
npx prisma migrate dev --name savedsearch_unique_anon
```

Update the POST handler (see F1) to upsert against the appropriate composite key.

**Acceptance.**
- Saving the same `{rawQuery, filters}` twice from the same anon ID returns 200 with the
  same row id.

---

### F10. Handle Greenhouse `embed` path edge case

**File:** `src/lib/company.ts`, line 7.

**Root cause.** `boards.greenhouse.io/embed/job_board?for=<company>` returns `"embed"`
today.

**Change.**

```ts
if (host.endsWith('greenhouse.io') && path[0]) {
  if (path[0].toLowerCase() === 'embed') {
    return u.searchParams.get('for');
  }
  return path[0];
}
```

Add a test case for the embed URL.

**Acceptance.** Unit test passes; `extractCompany('https://boards.greenhouse.io/embed/job_board?for=acme')` returns `'acme'`.

---

## P1 — Performance / cost

### F11. Parallelize / batch job upserts in `cacheSearch`

**File:** `src/lib/cache.ts`, lines 41–64.

**Root cause.** 50 serial `prisma.job.upsert` calls. At 10 ms per round-trip that's
500 ms of blocking time on the SSE finalize.

**Change.** Either:
- `await Promise.all(results.map((r) => prisma.job.upsert(...)))` — simplest, retains
  per-row error isolation, but you still pay 50 round-trips concurrently.
- Or use a single `createMany({ skipDuplicates: true })` plus an `updateMany` for the
  rows that already existed (need to query first to know which). Worth it only if you're
  CPU-bound on the upserts.

Start with `Promise.all`; revisit if telemetry says you need the second approach.

Also wrap the per-row work plus the `searchCache.upsert` in `prisma.$transaction([...])`
so a partial failure doesn't leave dangling rows.

**Acceptance.**
- Time-to-first-byte of the `done` SSE event drops by the per-row latency × (N-1).
- Existing route tests still pass.

---

### F12. Don't block the SSE close on metrics writes

**File:** `src/app/api/search/route.ts`, line 135 (cache-miss) and line 84 (cache-hit).

**Root cause.** `await logMetrics(...)` runs before `controller.close()` (in finally).
Client already received `done`, but the connection lingers.

**Change.** Make `logMetrics` fire-and-forget:

```ts
void logMetrics({...}).catch((err) => {
  captureRouteError(err, { route: '/api/search', phase: 'metrics' });
});
```

Drop the `.catch(() => {})` swallow inside `logMetrics` so failures propagate to
`captureRouteError`.

**Acceptance.**
- The SSE connection closes immediately after `done`.
- Forced EventLog failure still logs an error via `captureRouteError`.

---

### F13. Wire request abort through to Exa / DeepSeek / client

**Files:** `src/app/api/search/route.ts`, `src/lib/exa.ts`, `src/lib/rerank.ts`,
`src/lib/parse-query.ts`, `src/components/SearchBox.tsx`.

**Root cause.**
- Server: route ignores `request.signal`. If the client navigates away, Exa + DeepSeek
  still complete. You pay.
- Client: `runSearch` doesn't abort the previous in-flight request before starting a new
  one. Two SSE streams interleave into the same state.

**Change.**

Server:
- Thread `request.signal` through to `parseQuery`, `searchJobs`, and `rerank`. Add a
  `signal?: AbortSignal` parameter to each, and pass it into the OpenAI / Exa SDK calls
  (`{ signal }` is already supported in `parse-query.ts:54` — replicate the pattern).
- In `start(controller)`, listen for the upstream abort and propagate.

Client:
- `const abortRef = useRef<AbortController | null>(null)` inside `SearchBox`.
- Before starting a new `runSearch`, `abortRef.current?.abort(); abortRef.current = new
  AbortController();` and pass `signal: abortRef.current.signal` to `fetch`.
- In the `while (true)` loop, break on abort.

**Acceptance.**
- Submit two queries in quick succession. Network panel shows the first SSE connection
  cancelled. State reflects only the second query's results.

---

### F14. (Optional) Coalesce concurrent identical queries

**File:** `src/lib/cache.ts` (new helper).

**Root cause.** Two clients with the same `queryHash` arriving within the same window
both hit Exa + DeepSeek. The cache only helps the third+ caller.

**Change.** Add a short-lived "in-flight" marker in Redis (Upstash already wired):

```ts
const lockKey = `search:inflight:${queryHash}`;
const got = await redis.set(lockKey, '1', { nx: true, ex: 30 });
if (!got) {
  // poll for cache for ~5s; if found, serve; else proceed without the lock
}
```

Keep this behind a feature flag — only worth it once you can measure duplicate spend.

**Acceptance.** Two parallel `curl` requests with the same query produce one Exa call
(check telemetry).

---

## P2 — Quality / behavior

### F15. Surface parse failures instead of fabricating `{role: rawQuery}`

**File:** `src/lib/parse-query.ts`, lines 63–68.

**Root cause.** Any failure — timeout, JSON error, missing tool call — silently returns
`{role: rawQuery}`. For a long query, `buildQueryString` then echoes the entire prompt as
the role.

**Change.** Distinguish "parsed with empty filters" from "parse failed":

```ts
export async function parseQuery(rawQuery: string): Promise<{ filters: Filters; rawQuery: string; parseError?: string }> {
  try {
    // ...
    return { filters, rawQuery };
  } catch (err) {
    return { filters: {}, rawQuery, parseError: err instanceof Error ? err.message : String(err) };
  }
}
```

In the route, when `parseError` is set, log it via `captureRouteError` (phase: 'parse')
and proceed with `{role: rawQuery}` only if `buildQueryString({})` would otherwise
produce an empty string.

**Acceptance.** Forcing a `parseQuery` timeout produces a `captureRouteError` log
entry with `phase: 'parse'` and the search still completes.

---

### F16. Validate LLM-parsed filter shape

**File:** `src/lib/parse-query.ts` after line 61.

**Root cause.** `JSON.parse(arguments) as Filters` trusts the LLM. If DeepSeek returns
`salaryMin: "120k"`, the UI throws on `filters.salaryMin.toLocaleString()`
(`SearchBox.tsx:287`). If `freshnessDays: -5`, `exa.ts:71` skips it (`> 0` guard) but
silently — the user thinks freshness was applied.

**Change.** Add a validator. Either hand-rolled or with `zod` (already in dep tree? add
if not):

```ts
function sanitizeFilters(raw: unknown): Filters {
  const f = raw as Record<string, unknown>;
  const out: Filters = {};
  if (typeof f.role === 'string' && f.role.trim()) out.role = f.role.trim().slice(0, 200);
  if (typeof f.seniority === 'string') out.seniority = f.seniority.trim().slice(0, 50);
  if (Array.isArray(f.skills)) out.skills = f.skills.filter((s): s is string => typeof s === 'string').slice(0, 20);
  if (typeof f.location === 'string') out.location = f.location.trim().slice(0, 100);
  if (typeof f.remote === 'boolean') out.remote = f.remote;
  if (typeof f.salaryMin === 'number' && Number.isFinite(f.salaryMin) && f.salaryMin > 0) out.salaryMin = Math.floor(f.salaryMin);
  if (Array.isArray(f.exclude)) out.exclude = f.exclude.filter((s): s is string => typeof s === 'string').slice(0, 20);
  if (typeof f.freshnessDays === 'number' && Number.isFinite(f.freshnessDays) && f.freshnessDays > 0) {
    out.freshnessDays = Math.min(Math.floor(f.freshnessDays), 365);
  }
  return out;
}
```

Call before `return { filters: sanitizeFilters(parsed), rawQuery }`.

**Acceptance.** Mock the LLM returning `{ salaryMin: '120k', freshnessDays: -5 }`. After
sanitize, both fields are absent.

---

### F17. Sanitize rerank indices

**File:** `src/lib/rerank.ts`, line 71.

**Root cause.** `rated.results.sort(...)` returns whatever the LLM emitted. A
hallucinated `idx: 99` becomes `exaResults[99]` (undefined) downstream.

**Change.**

```ts
const valid = rated.results
  .filter((r) => Number.isInteger(r.idx) && r.idx >= 0 && r.idx < results.length)
  .map((r) => ({
    idx: r.idx,
    score: typeof r.score === 'number' && r.score >= 0 && r.score <= 1 ? r.score : 0.5,
    fit: typeof r.fit === 'string' ? r.fit.slice(0, 120) : '',
  }));
return valid.sort((a, b) => b.score - a.score);
```

**Acceptance.** Unit test: pass results of length 3 + a rerank LLM response containing
`idx: 7`. The returned array has no `idx: 7`.

---

### F18. Canonicalize the hash input

**File:** `src/lib/hash.ts`.

**Root cause.** `JSON.stringify({q, f: filters})` preserves insertion order. If the LLM
ever returns `{remote, role}` instead of `{role, remote}`, hashes diverge. Same problem
if a future caller passes `{role, skills: []}` vs `{role}`.

**Change.**

```ts
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

export function hashQuery(rawQuery: string, filters: Filters): string {
  const normalized = normalizeQuery(rawQuery);
  const payload = JSON.stringify({ q: normalized, f: canonicalize(filters) });
  return createHash('sha256').update(payload).digest('hex');
}
```

Note: this changes the hash output. **All existing `SearchCache` and `SavedSearch` rows
will mismatch.** Plan one of:
- Drop the `SearchCache` table (TTL is 6h anyway — acceptable).
- For `SavedSearch`, write a one-off migration that recomputes hashes.

Add tests for: reorder-keys-same-hash, empty-array-elided, nested-array-order-invariant.

**Acceptance.** All new unit tests pass; existing tests still pass after fixture updates.

---

### F19. Make location regex case-insensitive on leading char

**File:** `src/lib/location.ts`, line 1.

**Root cause.** `[A-Z]` requires uppercase first letter. "Location: san francisco" fails.

**Change.**

```ts
const LOCATION_RX = /(?:Location|Based in|Office|Working from)\s*[:\-–—]\s*([\p{L}][\p{L}\s,/&\-]{1,60})/iu;
```

The `u` flag plus Unicode property escapes also handles non-ASCII city names (Zürich,
São Paulo).

Add tests for lowercase and for unicode.

**Acceptance.** New tests pass.

---

### F20. Bias Exa to English / preferred locale (optional but cheap)

**File:** `src/lib/exa.ts`, lines 60–69.

**Root cause.** No language filter — non-English ATS results (Personio in particular)
slip in.

**Change.** Pass `userLocation` and a language preference if the Exa SDK version
exposes them. Check the installed version (`exa-js@^2.13.0` in `package.json`) against
its docs.

**Acceptance.** Manual: run a query that previously returned a German Personio page.
Confirm it's gone (or scored lower).

---

### F21. Verify Exa `category: "job posting"` is valid

**File:** `src/lib/exa.ts`, line 63.

**Root cause.** The Exa category set has shifted over time. If `"job posting"` is no
longer accepted, it's silently dropped and you're paying for general neural search.

**Change.** Verify in the Exa SDK source under `node_modules/exa-js/` (or via
`context7`/Exa docs MCP) which category strings the current SDK accepts. If `"job_posting"`
(underscore) or another variant is required, switch to it. If categories are gone, remove
the param.

**Acceptance.** A logged Exa request shows the category in the request body and Exa
returns a 200 without warnings.

---

## P3 — Polish

### F22. Don't swallow EventLog failures

**File:** `src/app/api/search/route.ts`, line 178.

Replace `.catch(() => {})` with `.catch((err) => captureRouteError(err, { route: '/api/search', phase: 'metrics' }))`.

### F23. Drop redundant `lastSeenAt: new Date()`

**File:** `src/lib/cache.ts`, line 60.

`@updatedAt` already updates on every `update`. Remove the explicit set.

### F24. `handleDropFilter` sends raw query, not updated filters

**File:** `src/components/SearchBox.tsx`, lines 178–198.

Either:
- Drop the `updated` arg from `runSearch(updated)` since it's ignored, and accept that
  dropping a chip re-parses; or
- Wire the API to accept a `filters` override in the POST body, bypass `parseQuery` when
  present, and have `runSearch(filters)` send it. This gives users an actual "I removed
  this filter" experience.

If you choose option 2, document the new contract in the route handler.

### F25. `observe.captureRouteError` should actually send to Sentry

**File:** `src/lib/observe.ts`.

`@sentry/nextjs` is in deps but never called. Either remove the dep or call
`Sentry.captureException(err, { tags: ctx })` alongside the console.error.

### F26. Bound in-memory rate-limit map

**File:** `src/lib/rate-limit.ts`, line 30.

Dev-only fallback, but add a soft cap (e.g. 10k entries) to bound memory if Upstash init
ever fails in prod. A simple `if (buckets.size > 10_000) buckets.clear()` on the cold
path is enough.

### F27. Clean up `rerankScores` keys

**File:** `src/app/api/search/route.ts`, line 100.

```ts
rerankScores = Object.fromEntries(
  reranked
    .map((r) => [exaResults[r.idx]?.id, { score: r.score, fit: r.fit }] as const)
    .filter(([id]) => typeof id === 'string')
);
```

Filtering on key, not value, eliminates the `"undefined"` key footgun.

### F28. Cap query length

**File:** `src/app/api/search/route.ts`, after line 45.

```ts
if (rawQuery.length > 1000) {
  return new Response(JSON.stringify({ error: 'query too long' }), { status: 400, headers: ... });
}
```

Same for `/api/saved` POST.

---

## Acceptance summary

After all P0+P1 changes are in:

1. `npm test` → green.
2. Manual smoke test of the four flows:
   - Anonymous user runs a query, sees results, saves the search, refreshes — saved
     search appears in the sidebar.
   - Signed-in user runs the same flow — saved search appears, persists across sign-out
     and back in (against `userId`).
   - User hides a company, runs the same query again (cache-hot) — the hidden company
     does not appear.
   - User submits a query, then submits a different query before the first finishes — UI
     shows only the second query's results.
3. EventLog telemetry is correct:
   - Cache-miss rows have `exaMs > 0`, `cacheMs == 0`.
   - Cache-hit rows have `exaMs == 0`, `cacheMs > 0`.
   - Rerank-failure rows have `rerankFailed = true` and there is no corresponding
     `SearchCache` row.
4. No new ESLint or TypeScript errors.

## Not in scope for this fix

- Replacing DeepSeek with a different model.
- Adding pagination beyond the existing client-side "Show more".
- Authoring new ATS-host parsers beyond the ones explicitly listed in F6.
- Touching the visual design pass tracked under `mvp2_visual_uplift.md`.
