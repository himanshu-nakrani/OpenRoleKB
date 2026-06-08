# Phase 3 — Product quality

Goal: get the product to a state where nothing surprises a user and
nothing surprises us. Not new surface area, not monetization, not
growth tactics. Just: the existing flows work the way a user would
expect, the data we already capture produces honest answers, and the
operational rough edges from Phase 2 are gone.

Horizon: open-ended. Items are sequenced by dependency, not calendar.
Ship them in order; each unblocks the next.

---

## What's actually shipped after Phase 2

Honest state of the product as of today, separating "works for users"
from "scaffolded but not user-visible" from "still broken":

### Works end-to-end ✅
- Natural-language search → Exa neural retrieval → Gemini rerank → SSE-streamed UI
- Two-pane results layout with independent scroll, keyboard nav, dark/light theming
- Editorial landing page with demo loop on empty state
- Anonymous-first identity + magic-link sign-in + cross-device transfer codes
- Hide-company filter on both cache hits and misses
- Saved searches CRUD + the new cadence dropdown
- FreshnessPill + StillListedBadge + "This week" filter (just shipped)
- Per-search cost and token capture in `EventLog`
- `/admin/health` dashboard with Traffic / Latency / Cost / Quality sections
- Privacy / Terms / About pages with footer links

### Scaffolded but not user-visible 🟡
- Saved-search digest cron (`/api/cron/saved-search-run`)
  - Schema, route, email template, UI all exist
  - **No Vercel cron schedule wired** → currently a dormant endpoint
  - Hardcoded `digest@openrolekb.example.com` From address; `RESEND_FROM`
    env exists but isn't read
  - First-run baseline missing → first tick on a new saved search will
    send a 50-job blast
  - `lastRunAt` written before email send → partial failure won't retry
  - No abort signal threading or concurrency cap in the cron loop
- Contract test (`testcontainers`) — CI workflow exists but needs Docker
  on the runner, not yet validated green

### Known broken or noisy 🔴
- Three `Router action dispatched before initialization` browser console
  warnings on first paint (`useMergeOnSignIn` or lazy-modal dispatch
  before router ready)
- `EventLog` pollution: cron writes rows with `parseMs: 0, exaMs: 0` for
  digest events, skewing the p95 latency on `/admin/health`
- `cache-purge` cron purges anon data at 30 days; privacy page says 90
  days. One of them is lying to users.
- `/api/saved` and `/api/health` cold-start at 3s+ on first request
  (cold Prisma connection to Neon)

### Not started 🚫
- Multi-turn refinement
- Filter chips that drive the search (route accepts override; UI doesn't)
- `/job/[id]` permalinks
- Salary + location extraction
- SEO sitemap + robots
- Click-through tracking on Apply links
- Cross-source dedup
- Trending widget
- `/changelog` page
- Rerank A/B harness

---

## Phase 3 plan

10 items, dependency-ordered. **Ship in order.** Most depend on the
previous one being clean.

### P3.0 — Close out the rough edges from Phase 2

These four items are *already on disk*, just not finished. Doing them
first means the saved-search retention feature actually works and the
dashboard tells the truth. None of them are net-new — they're closing
loops we opened.

#### P3.0.1 Schedule the cron + wire RESEND_FROM 🚀
**Effort:** 0.5 day · **Risk:** medium (first email-sending in prod)

- [ ] Add cron entry to `vercel.json`:
      `{"path": "/api/cron/saved-search-run", "schedule": "17 14 * * *"}`
      (14:17 UTC daily — odd minute avoids the :00 stampede)
- [ ] Replace the hardcoded `"OpenRoleKB <digest@openrolekb.example.com>"`
      in `/api/cron/saved-search-run/route.ts` with
      `process.env.RESEND_FROM`. Refuse to send (warn + skip) if unset.
- [ ] Document DKIM setup in `docs/RELEASE.md` (manual step on Resend
      dashboard for whatever domain you actually own)
- [ ] Set `EMAIL_TEST_MODE=true` in prod for first 7 days so digests go
      only to `ADMIN_EMAIL`

**Definition of done:** the cron tick at 14:17 UTC produces one or more
emails landing in `ADMIN_EMAIL`'s inbox, with valid DKIM + DMARC checks.

#### P3.0.2 First-run baseline behavior
**Effort:** 0.5 day · **Risk:** low

The cron currently treats every job in the first cron tick as "new"
because there's no previous `SavedSearchRun` to diff against. A user
opting into daily cadence would get a 50-job blast that night.

- [ ] On first tick for a saved search: write a `SavedSearchRun` row
      with `newJobIds: <all current ids>` and `deltaCount: 0` (or a new
      `isBaseline: true` column). **Don't send an email.**
- [ ] Next tick: diff normally. User gets only genuinely-new jobs.

**Definition of done:** integration test in `cron-baseline.test.ts`
that runs the cron twice on a fresh saved search and asserts only the
second run sends an email, with only the *delta* in `newJobIds`.

#### P3.0.3 Retry-safe email send ordering
**Effort:** 0.5 day · **Risk:** low

Today: `update({lastRunAt: now})` runs *before* the email send. If
Resend fails mid-batch, we won't retry that user until the next tick,
and the second tick will diff against a stale `SavedSearchRun` that
already includes the un-emailed jobs.

- [ ] Restructure: write `SavedSearchRun` row + update `lastRunAt` AFTER
      successful email send (or after final retry failure).
- [ ] Add a per-saved-search retry on Resend 4xx (one immediate retry,
      then give up and log).

**Definition of done:** stub Resend to throw on first call; confirm
`lastRunAt` is unchanged and the next tick re-sends.

#### P3.0.4 Stop polluting EventLog latency aggregates
**Effort:** 0.25 day · **Risk:** low

`/admin/health` currently averages `totalMs` across all `EventLog`
rows, including `saved_search_run_completed` and `digest_email_sent`
events that have `totalMs: 0`. The p95 is silently wrong.

- [ ] In `/admin/health`, filter to `evt = 'search'` for the latency
      percentile calculation
- [ ] Add a separate "Cron" section showing digest send count + success
      rate over 24h

**Definition of done:** screenshot the dashboard with the fix; p95
should change measurably if there have been any cron events.

---

### P3.1 — Make the search results actually useful for decision-making

A user has 50 ranked results in front of them. Right now they can read
title, company, score, and posting date. To actually decide which one
to apply to, they need more.

#### P3.1.1 Salary extraction
**Effort:** 1 day · **Risk:** low

- [ ] Regex pass over `Job.description` for `$\d{2,3}k?(\s*[-–to]\s*\$?\d{2,3}k?)?`
      and the £ / € equivalents
- [ ] Store in new columns `salaryMinUsd`, `salaryMaxUsd`, `salaryRaw`
      (raw text for the rare case the regex caught the wrong number)
- [ ] Migration + idempotent backfill cron over existing rows
- [ ] Display in `ResultRow` (compact: `$140–190k`) and `DetailPane`
      (full breakdown if range, "estimated" badge if extracted from
      ambiguous text)

**Definition of done:** unit tests on 20 real ATS description excerpts
showing the regex hits >70% of jobs that contain salary text without
false positives (no equity %, no PTO days mistaken for salary).

#### P3.1.2 Geo-normalize location
**Effort:** 0.5 day · **Risk:** low

Today: `Job.location` is whatever the ATS HTML had. "SF", "San
Francisco, CA", "Bay Area", "San Francisco, California, United States"
all show up as distinct strings. User can't filter or compare.

- [ ] Build a small lookup table (~30 entries) for the most common
      variants → canonical form
- [ ] Apply during `cacheSearch` job upsert + as a one-shot backfill
- [ ] Display canonical form; keep raw in `Job.locationRaw` for
      debugging
- [ ] Anti-scope: no NLP, no geocoding. Just a table.

**Definition of done:** the same job posted via greenhouse and lever
collapses to the same `location` string after normalization.

#### P3.1.3 Cross-source dedup
**Effort:** 1.5 days · **Risk:** medium

Same job from two ATS hosts (e.g., a posting on both greenhouse and
linkedin) currently shows up as two cards. Worse, sometimes Exa returns
duplicates within a single search.

- [ ] Compute a `dedupKey` = sha256(normalized title + canonical
      company + canonical location)
- [ ] When upserting Jobs, find existing row with same `dedupKey` and
      either merge or skip
- [ ] On the read side, group results by `dedupKey` and pick the
      highest-scoring representative + collapse the rest into a "+2
      more sources" affordance
- [ ] Anti-scope: no embedding-based dedup (parked in
      `docs/discuss/embeddings-architecture.md`)

**Definition of done:** searching a popular role (e.g., "senior swe
San Francisco") produces noticeably fewer cards, none of them obvious
duplicates.

---

### P3.2 — Make user actions feel solid

Today: clicking Apply goes to the ATS, but we don't know if the click
happened. Saving / hiding / feedback all work but have rough edges.

#### P3.2.1 Click-through tracking on Apply
**Effort:** 0.5 day · **Risk:** low

- [ ] New endpoint `GET /api/jobs/[id]/click` that writes a
      `JobInteraction` row of kind `clicked`, then 302s to the real URL
- [ ] Wrap the Apply button's `href` to point at this endpoint
- [ ] Add to `EventLog`: `apply_clicked` events
- [ ] Surface on `/admin/health` as "Click-through rate (24h)" — the
      single most important quality signal we don't yet have

**Definition of done:** clicking Apply on a result writes a row;
dashboard shows a non-zero CTR.

#### P3.2.2 Multi-turn refinement
**Effort:** 1.5 days · **Risk:** medium (touches the LLM prompt)

User runs "senior react remote" → gets 10 results that are too senior →
should be able to say "actually mid-level" without retyping the whole
query.

- [ ] Inline "Refine" input below the results list
- [ ] `/api/search` accepts optional `{refineFrom: {rawQuery, filters}}`
      and a new free-text `refinement`
- [ ] LLM prompt: given prior filters + a refinement string, return new
      filter set
- [ ] Client preserves refinement chain in URL state for shareable
      refined-search links
- [ ] Anti-scope: no conversational memory across sessions. Each
      refinement is stateless: prior filters + new refinement → new
      filters

**Definition of done:** refining "senior react remote" with "too
senior" returns mid-level results without dropping "react" or "remote";
sharing the URL reproduces the same refined search.

#### P3.2.3 Finish F24 — filter chips drive the search
**Effort:** 0.5 day · **Risk:** low

The route already accepts `body.filters` and sanitizes it. The UI just
doesn't use that path: clicking the × on a chip re-runs with the raw
query string, which re-parses through the LLM. Same result, wasted
tokens.

- [ ] When a chip is removed in `SearchBox`, build the new filter set
      client-side and POST with `{query, filters: newFilters}`
- [ ] Cache key uses sanitized filters consistently so the modified
      query produces a fresh cache row

**Definition of done:** removing the "remote" chip from a result
re-runs the search and shows non-remote results, without re-parsing
through Gemini (verify in EventLog: `parseMs: 0` on the chip-driven
re-run).

---

### P3.3 — Make jobs shareable and discoverable

Today every job lives at `/search/[id]` as a transient result. Nothing
is shareable.

#### P3.3.1 `/job/[id]` permalink pages
**Effort:** 2 days · **Risk:** low

- [ ] New route `src/app/job/[id]/page.tsx` reading `Job` from DB and
      rendering with the same `DetailPane` layout
- [ ] Per-job dynamic OG image via the existing `/api/og` route (title +
      company + score query params)
- [ ] `JobPosting` structured data for Google
- [ ] Anti-scope: no apply-on-page; we link to the ATS. No comments.

**Definition of done:** copying a `/job/abc123` URL into a Twitter post
produces a card with the role title and company. The page loads
without JS (server-render the body, only modals are client).

#### P3.3.2 SEO sitemap + robots
**Effort:** 0.5 day · **Risk:** low

- [ ] `app/sitemap.ts` that includes `/`, `/about`, `/privacy`,
      `/terms`, `/job/[id]` for every cached Job
- [ ] `app/robots.ts` allowing index of `/`, `/job/*`, `/about`,
      `/privacy`, `/terms`, `/changelog`. Disallow `/search/*`,
      `/admin/*`, `/api/*`
- [ ] Submit sitemap to Google Search Console (manual step in
      `docs/RELEASE.md`)

**Definition of done:** `curl /sitemap.xml` returns a valid sitemap
listing every Job; Google Search Console accepts it.

---

### P3.4 — Make the dashboard tell the truth

Most of this exists; the data plumbing just needs to be cleaner.

#### P3.4.1 Retention metrics on /admin/health
**Effort:** 0.5 day · **Risk:** low

The `digest_email_sent` and `saved_search_run_completed` events are
already being written. The dashboard just doesn't aggregate them yet.

- [ ] New "Retention" section: digests sent / 24h, click-through % (the
      click-tracking from P3.2.1 powers this), opt-in % (saved searches
      with cadence != "off" / total saved searches)
- [ ] Sparkline of digest sends over 7 days

**Definition of done:** the dashboard answers "is anyone using the
digest?" without needing a SQL query.

#### P3.4.2 Hidden-company aggregation
**Effort:** 0.5 day · **Risk:** low

When ≥3 distinct ownerKeys hide the same company on similar queries,
that's signal the rerank is missing something. Surface it.

- [ ] New section on `/admin/feedback`: "Most-hidden companies (last 7
      days)" — top 10 by distinct ownerKey count
- [ ] For each, show the most common queries that surfaced them

**Definition of done:** dashboard shows a list; clicking a company
shows the queries.

---

### P3.5 — Confidence in changes

The eval harness exists but only runs nightly against the current
rubric. Changing the rubric is currently a leap of faith.

#### P3.5.1 Rerank A/B harness
**Effort:** 1 day · **Risk:** low

- [ ] Extend `scripts/eval.ts` to accept `--compare <rubric-file>`
- [ ] Score the same goldens against both rubrics; emit per-case score
      delta + aggregate pass-rate delta
- [ ] CI workflow `.github/workflows/eval-ab.yml` triggered manually
      with two refs

**Definition of done:** running the harness with the current rubric vs
a hand-edited copy with one word changed produces measurable score
differences; output is reviewable as a diff.

#### P3.5.2 Visual regression for the home page
**Effort:** 1 day · **Risk:** low

The home page has been the source of two layout regressions already
(the search-results overflow bug, the editorial-landing unmount bug).
A screenshot test catches both.

- [ ] Playwright + `@playwright/test`'s `toHaveScreenshot` for
      `/` light + dark, mobile + desktop (4 screenshots)
- [ ] CI workflow runs against PR previews
- [ ] Screenshots stored in `test/screenshots/`

**Definition of done:** intentionally introducing a CSS regression on
`page.tsx` fails the workflow with a side-by-side diff.

---

### P3.6 — Cold-start the connection pool

Mentioned in the state assessment: first request after a quiet period
sits at 3s+ because Prisma is opening a cold connection. Not technically
broken, but a user's first search shouldn't take 3 seconds before Exa
even gets called.

#### P3.6.1 Connection warmup
**Effort:** 0.5 day · **Risk:** low

- [ ] In `instrumentation.ts`, run `prisma.$queryRaw\`SELECT 1\`` on
      Node-runtime init. Keeps the connection pool warm across
      requests in the same instance
- [ ] Verify on Vercel that `serverless` is using Fluid Compute (warm
      instances across cold starts within the same region)

**Definition of done:** p95 of the first request after a 5-min idle
window is < 1s.

---

## Sequencing

```
Week 1 — close-out:    P3.0.1  →  P3.0.2  →  P3.0.3  →  P3.0.4
Week 2 — useful results: P3.1.1  →  P3.1.2  →  P3.1.3
Week 3 — actions:      P3.2.1  →  P3.2.2  →  P3.2.3
Week 4 — discoverability: P3.3.1  →  P3.3.2
Week 5 — truthful UI:  P3.4.1  →  P3.4.2
Week 6 — confidence:   P3.5.1  →  P3.5.2  →  P3.6.1
```

The bucket order is dependency-driven:

- **P3.0 first** because the retention loop is the highest-leverage
  feature already on disk; finishing it unlocks user signal that drives
  later decisions.
- **P3.1 second** because every later item (permalinks, dedup, refinement)
  is more valuable on a result page that shows salary + clean location.
- **P3.2 third** because click-through tracking from P3.2.1 powers the
  dashboard metrics in P3.4 — easier to land them in order.
- **P3.3, P3.4, P3.5, P3.6** are independent of each other; pick by mood.

---

## Decision checkpoints

After each bucket, before starting the next:

1. **After P3.0**: run cron in `EMAIL_TEST_MODE=true` for 7 days. If
   `ADMIN_EMAIL` actually opens the digests >50% of the time, the
   retention hypothesis holds. If not, **stop and re-think the digest
   format** — there's no point shipping a feature users ignore.

2. **After P3.1**: run a single search yourself with the new salary +
   location + dedup. Pick 10 cards at random. If the salary range
   shown matches the description text in at least 7, the regex is good
   enough. Otherwise tune before moving on.

3. **After P3.2**: deploy click tracking and watch CTR for one week.
   The eval suite's pass-rate is a proxy for relevance; CTR is the
   ground truth. If they disagree wildly, the rubric is wrong.

4. **After P3.5**: try changing one word in the rerank rubric. If the
   A/B harness produces no measurable score delta, the goldens aren't
   discriminative enough — add 5 more before shipping rubric changes
   based on this signal.

---

## What's explicitly out of scope

To prevent scope creep — these are real features but they don't fit
"improve the product" right now:

- **Monetization** (Stripe, tier paywall, budget alarms). Pricing
  decisions need real usage data; phase 3 generates it.
- **New auth flows** (OAuth, social sign-in). Magic link works; users
  who sign up will use it.
- **Mobile app, browser extension, embeddable widget**. Web-first.
- **Vector-DB pivot**. Parked in `docs/discuss/embeddings-architecture.md`.
  Don't re-litigate until the decision-gate signals in that doc trigger.
- **Recruiter-side product**. Different product.
- **Comparison mode** (compare 2-3 jobs side-by-side). Tempting but
  Pro-tier-shaped; defer.

---

## What I'm not certain about

Calling out uncertainty so you can correct it if my read is wrong:

1. **The retention hypothesis might be wrong.** I'm assuming digest
   emails are the lever; they might not be. P3.0.1's 7-day test is
   designed to surface that — but if `ADMIN_EMAIL` isn't *you* during
   the test, the signal is noise.

2. **The "more useful results" items (P3.1) are guesses about user
   pain.** I haven't heard a user say "I can't tell the salary." If
   the actual complaint is something else (job postings are too old?
   too few EU listings? rerank rates too senior?), reorder
   accordingly.

3. **Permalink SEO (P3.3) is high-effort, low-evidence.** Two days of
   work to maybe rank for a long tail. If you don't believe organic
   SEO will move the needle in 6 months, swap P3.3 for P3.4 + P3.5.

4. **Visual regression tests (P3.5.2) cost real CI minutes.** If
   Playwright's cost is meaningful at your scale, the boundary tests
   on `FreshnessPill` are arguably enough.

---

## Top 5 to ship this week

If only 5 things happen:

1. **P3.0.1** — cron schedule + `RESEND_FROM` env. Two-line change in
   `vercel.json` + one line in the cron route. Unlocks the entire
   retention loop the rest of phase 2 was building toward.
2. **P3.0.2** — first-run baseline. Without it, anyone who turns on
   "daily" gets a junk first email and probably opts out before the
   second tick proves the feature.
3. **P3.0.4** — filter EventLog by `evt = 'search'` in the dashboard
   latency math. One-line fix. The dashboard is currently lying about
   p95 and you can't run an honest performance discussion until it's
   not.
4. **P3.2.1** — click-through tracking. The single highest-value
   telemetry signal we're missing. Half a day. Powers every later
   quality decision.
5. **P3.6.1** — Prisma connection warmup. A user's first search after
   a quiet period sitting at 3s is the worst first impression we
   currently ship. Half a day.
