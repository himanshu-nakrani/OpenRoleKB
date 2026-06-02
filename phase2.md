# Phase 2 — Product depth & retention

The work since PRODUCTION_PLAN.md was written closed most of Phase 0
(observability, security headers, structured logger, CI) and most of Phase 1
(Aurora theme, OG card, empty/loading/error states, editorial landing). The
search pipeline is hardened, the metrics platform records cost + tokens per
request, and a nightly eval runs against frozen goldens.

What we **don't** have yet:
- A reason for users to come back tomorrow (saved-search cadence + digest).
- A way for users to refine a query without retyping it.
- A way to share or bookmark a specific job.
- An end-to-end safety net (real-DB contract test).
- Margin clarity (we capture cost; we haven't priced anything).

This document is the plan for the next 4–6 weeks. Each item has a clear
deliverable, an owner-of-decision (you), and a definition of done. Items
tagged 🚀 ship before anything below them; 💰 affect monetization directly.

---

## Conventions

- **Effort**: calendar days for one full-time builder.
- **Risk**: low / medium / high — likelihood of breaking something live.
- **Why now**: what costs us not shipping this.
- **Definition of done**: what an outsider can verify.
- **Anti-scope**: explicit "we are NOT doing X yet" so the work stays bounded.

---

## P0 — Stop carrying tech debt forward (1 week) 🚀

These four close the loop on what was started but not finished. Without
them, every later feature builds on a slightly broken foundation.

### P0.1 Real-DB contract test for `/api/search`
**Effort:** 1 day · **Risk:** low · **Why now:** every search bug we shipped
this quarter would have been caught by this test.

- [ ] Add `vitest-postgres` or `testcontainers` to dev deps.
- [ ] One test that boots Postgres, runs migrations, mocks Exa + DeepSeek,
      hits `/api/search` once with a fresh query (asserts cache miss + write),
      then again (asserts cache hit + same `EventLog` shape).
- [ ] Wire it as a separate CI job (slower than unit tests; gates merges to
      `main` but not PRs against feature branches).

**Definition of done:** PR includes a passing CI job named `contract`.

---

### P0.2 Verify Sentry release markers in prod
**Effort:** 0.5 day · **Risk:** low

- [ ] Set `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` in Vercel.
- [ ] Trigger a deliberate error in prod (e.g. POST `/api/search` with an
      oversized body).
- [ ] Confirm it appears in Sentry with the right release tag, environment,
      and PII-scrubbed payload (no email, no rawQuery).

**Definition of done:** screenshot of a real Sentry issue with the right
release marker, linked into the PR description.

---

### P0.3 Web Vitals + bundle audit
**Effort:** 1 day · **Risk:** low

- [ ] Install `@vercel/speed-insights`. Verify LCP/INP/CLS land in the
      Vercel dashboard.
- [ ] `next build` then check `.next/analyze`. Anything in the initial
      JS bundle that isn't necessary for the home render gets a
      `dynamic()` wrapper or moves to a route segment.
- [ ] Specifically: confirm `lucide-react` is tree-shaken (sometimes
      barrel imports defeat tree-shaking; switch to per-icon paths if
      so).

**Definition of done:** initial JS bundle for `/` < 200KB gzipped,
Lighthouse Performance ≥ 90 on both light and dark.

---

### P0.4 Two pre-existing ESLint warnings
**Effort:** 0.5 day · **Risk:** low

- [ ] `ResultsList.tsx:37` set-state-in-effect — derive `visibleCount`
      from a `key` prop change or move to event handlers.
- [ ] `SearchBox.tsx:349` set-state-in-effect (the example queries
      visibility) — handled by `useSyncExternalStore` in the recent
      lint pass; verify clean.

**Definition of done:** `npm run lint` → 0 errors / 0 warnings.

---

## P1 — The retention loop (2 weeks) 🚀💰

The single feature most likely to convert "tried it once" into "uses
it weekly." Without saved-search cadence we are a one-shot search
engine; with it, we are a job-discovery surface users come back to.

### P1.1 Saved-search cadence model
**Effort:** 1 day · **Risk:** low

- [ ] Add to `SavedSearch`: `cadence: "off" | "daily" | "weekly"`,
      `lastRunAt: DateTime?`, `lastNotifiedAt: DateTime?`,
      `notifyEmail: String?` (defaults to `User.email` when present).
- [ ] Migration. Schema additions only; no data changes.

**Definition of done:** migration applies cleanly, tests pass, no
behavioral change in the existing search flow.

---

### P1.2 Cadence-triggered re-run cron
**Effort:** 2 days · **Risk:** medium — first place we automate spend.

- [ ] New endpoint `/api/cron/saved-search-run`, gated by
      `CRON_SECRET` (same pattern as cache-purge).
- [ ] Selects all `SavedSearch` with `cadence != "off"` and
      `lastRunAt < now - cadenceInterval`.
- [ ] For each, runs the same search pipeline as `/api/search` but
      with no SSE; collects results.
- [ ] Diffs against the last cached run (need to remember per
      saved-search what we previously surfaced); writes a delta of
      "new since last check" into a new `SavedSearchRun` table.
- [ ] Updates `lastRunAt`.

Anti-scope: don't optimize. Run sequentially. Profile when we have
more than ~1000 saved searches.

**Definition of done:** triggering the endpoint manually produces
`SavedSearchRun` rows with non-empty deltas for at least one fixture
saved search.

---

### P1.3 Email digest (Resend)
**Effort:** 2 days · **Risk:** medium — first user-facing email.

- [ ] Email template (React Email or plain HTML) — branded, single
      "Open the search" CTA, no more than 5 results, link to permalink.
- [ ] Sender domain configured + DKIM verified (manual setup
      checklist in `docs/RELEASE.md`).
- [ ] Test mode flag — when set, emails go only to `ADMIN_EMAIL`.
- [ ] Cron sends emails for any `SavedSearchRun` with > 0 delta and
      `lastNotifiedAt < lastRunAt`, then updates `lastNotifiedAt`.

Anti-scope: no in-app inbox UI yet. No SMS, no push. No "we found
nothing new this week" emails.

**Definition of done:** end-to-end: opt a fixture saved search into
`daily` cadence, run the cron, get an email at `ADMIN_EMAIL` with
real-looking matches.

---

### P1.4 Cadence UI on the saved-search row
**Effort:** 1 day · **Risk:** low

- [ ] Dropdown next to each saved search: Off / Daily / Weekly.
- [ ] Inline confirmation toast when cadence changes.
- [ ] Email-input affordance when the user isn't signed in (we have
      `anonId` saved searches; for those we need an email or we
      gracefully refuse cadence with "Sign in to enable").

**Definition of done:** user can flip cadence in the UI, the DB
updates, the UI reflects the new state on refresh.

---

### P1.5 Telemetry on the loop
**Effort:** 0.5 day · **Risk:** low

- [ ] Track in `EventLog`: `saved_search_run_completed`,
      `digest_email_sent`, `digest_email_clicked` (via tracking pixel
      or wrapped link).
- [ ] `/admin/health` gains a "Retention" section: searches saved
      24h, digests sent 24h, click-through rate.

**Definition of done:** dashboard shows non-zero numbers after the
first cron tick in prod.

---

## P2 — Make a single search produce more value (1–2 weeks)

Today a user runs one query, scans 5 results, leaves. We can extract
more value from each search without making them retype.

### P2.1 Multi-turn refinement
**Effort:** 2 days · **Risk:** medium — touches the LLM prompt.

- [ ] New "Refine" affordance below the results list. Free-text
      input ("too senior", "only EU", "exclude crypto").
- [ ] `/api/search` accepts an optional `refineFrom: { rawQuery,
      filters }` parameter. When present, the LLM gets a new system
      prompt that takes prior filters + refinement → updated filters.
- [ ] Client preserves the refinement chain in URL state (so users
      can share).

Anti-scope: no conversational memory across sessions. Each refinement
is stateless: prior filters + new refinement → new filters.

**Definition of done:** refining "senior react remote" with "too
senior" returns junior/mid-level results without "react" or "remote"
disappearing.

---

### P2.2 Filter chips that drive the query (finish F24)
**Effort:** 1 day · **Risk:** low — the route already accepts a
`filters` override.

- [ ] Clicking the × on a chip removes it from `state.filters` and
      re-runs with the modified filters via the existing
      `filtersOverride` path.
- [ ] Verify cache key uses sanitized filters consistently.

**Definition of done:** removing "remote" from a chip removes
remote-only roles from the results without retyping.

---

### P2.3 Permalink job pages `/job/[id]`
**Effort:** 2 days · **Risk:** low

- [ ] Server route that reads `Job` from DB, renders a static page
      with the same `DetailPane` layout used in the two-pane view.
- [ ] Metadata: per-job OG image (uses the existing `/api/og` route
      with title + company + score query params).
- [ ] `JobPosting` structured data for Google.
- [ ] Sitemap includes every job we've ever cached.

Anti-scope: no apply-on-page (we link to the ATS). No comments.

**Definition of done:** sharing a job link on Twitter shows a custom
OG card; the page loads without JS; Search Console accepts the
structured data.

---

### P2.4 Salary + location extraction
**Effort:** 1 day · **Risk:** low — pure server work, no UX change.

- [ ] Regex over `Job.description` for `\$\d{2,3}k?` patterns,
      `€\d+`, `£\d+`. Store min/max in new columns `salaryMinUsd`,
      `salaryMaxUsd`.
- [ ] Geo-normalize: lookup table for ~20 common variants
      ("SF" / "Bay Area" / "San Francisco, CA" → `SF`).
- [ ] Backfill cron over existing rows (one-shot, idempotent).

**Definition of done:** ResultRow shows "$140k–$190k" when present;
"San Francisco" badge collapses regional variants.

---

## P3 — Trust + growth (1–2 weeks, parallel)

These don't add features but reduce the "is this safe to use" friction
and create surface area for organic discovery.

### P3.1 `/privacy`, `/terms`, `/about`
**Effort:** 1 day · **Risk:** low — but legal liability if skipped.

- [ ] Templates from iubenda or Termly for first draft.
- [ ] Voice pass to match the rest of the site.
- [ ] Link in footer.
- [ ] Cookie banner ONLY if we set non-essential cookies — currently
      we don't, so a one-liner ("we don't track you") goes on the
      privacy page instead of a popup.

**Definition of done:** all three pages live; linked from the footer
and `/admin/health` doesn't show consent-banner-related events.

---

### P3.2 Trending searches widget
**Effort:** 1 day · **Risk:** low.

- [ ] SQL view over `EventLog`: top 10 distinct `rawQuery` (after
      normalization) in the last 24h with `resultCount > 0`.
- [ ] Optional component on the home page below the demo loop,
      anonymized: "What people are asking today."

Anti-scope: no per-query click counts (until we wire that). No
personalization.

**Definition of done:** the home page shows 10 queries that change
day-to-day.

---

### P3.3 Changelog page (`/changelog`)
**Effort:** 0.5 day · **Risk:** low.

- [ ] Auto-generate from `CHANGELOG.md` (which currently exists but
      is barely populated).
- [ ] Maintain religiously after every meaningful PR.

**Definition of done:** `/changelog` shows the last 6 weeks of work
in reverse chronological order.

---

### P3.4 SEO surface
**Effort:** 1 day · **Risk:** low.

- [ ] `robots.txt`: allow `/`, `/job/*`, `/changelog`. Disallow
      `/search/*`, `/admin/*`, `/api/*`.
- [ ] `sitemap.xml`: generate on build from a DB query.
- [ ] Per-page metadata via the `template` already set up in
      `layout.tsx`.

**Definition of done:** Search Console accepts the sitemap; coverage
report shows our `/job/*` pages indexed within 2 weeks.

---

## P4 — Monetization preflight (1 week) 💰

This is decision work, not implementation. We can't price what we don't
understand.

### P4.1 Cost model spreadsheet
**Effort:** 0.5 day · **Risk:** low — but blocks everything below.

Input columns: searches/user/month, Exa $/req, DeepSeek tokens × rate.
Outputs: cost per user per month at 10/30/100 searches/month.

Use the real numbers now sitting in `EventLog.exaCostUsd` +
`EventLog.llmCostUsd` over the last 30 days.

**Definition of done:** spreadsheet checked into `docs/cost-model.md`
showing gross margin at three price points: Free, Plus, Pro.

---

### P4.2 Daily budget alarms
**Effort:** 0.5 day · **Risk:** low.

- [ ] Cron that sums `exaCostUsd + llmCostUsd` over the past 24h.
- [ ] If > configured threshold, posts to a webhook (Slack? email
      to `ADMIN_EMAIL`?) AND degrades the free tier to cache-only
      until the next reset.

**Definition of done:** force the threshold low, trigger the cron,
get the alert, confirm `/api/search` returns cache-only.

---

### P4.3 Tier definition (decision document)
**Effort:** 1 day · **Risk:** low — but high-stakes for the business.

Default proposal (steal/adjust):

- **Free** — 30 searches/month · 5 saved searches · no digest.
- **Plus ($8/mo)** — unlimited searches · unlimited saved · daily
  digest · multi-turn refinement.
- **Pro ($24/mo)** — Plus + API access + priority rerank model.

Open questions to decide:
- Is this monthly or pay-as-you-go?
- Do we differentiate by model quality or by feature set?
- What's the trial mechanic?

**Definition of done:** `docs/pricing.md` captures the decisions and
the rejected alternatives.

---

### P4.4 Stripe wiring (deferred to first paying user)
**Effort:** 2 days · **Risk:** medium.

Don't build this until P4.3 is signed off and at least one user has
asked for a Plus account. Pre-building Stripe before there's demand
is the biggest waste in SaaS.

---

## P5 — Quality moat (ongoing)

The product's actual competitive advantage is the feedback loop. Each
of these makes the loop better.

### P5.1 Rerank A/B harness
**Effort:** 2 days · **Risk:** low.

- [ ] Extend eval harness to score two rubric versions against the
      same goldens.
- [ ] CLI flag `--compare <rubric-file>`.
- [ ] Output: per-case score delta, aggregate pass-rate delta.

**Definition of done:** running the harness on the current rubric vs
a copy with one word changed produces measurable score differences.

---

### P5.2 Hidden-company feedback loop
**Effort:** 1 day · **Risk:** low.

- [ ] When a user hides a company, capture the query that surfaced
      it. Aggregate into a "frequently hidden across many users for
      these queries" signal.
- [ ] Surface in `/admin/feedback` as a list with counts.

**Definition of done:** dashboard shows companies hidden by ≥ 3
distinct ownerKeys grouped by recurring query terms.

---

### P5.3 Click-through tracking
**Effort:** 1 day · **Risk:** low.

- [ ] Wrap the "Apply on X" link with `/api/jobs/[id]/click` that
      302s to the real URL and writes a `JobInteraction` row of
      kind `clicked`.
- [ ] Add a click-through column to `/admin/health` and the eval
      goldens (a result that nobody clicks is probably wrong).

**Definition of done:** the table at `/admin/health` shows
click-through rates per query type, sortable.

---

### P5.4 Weekly "what we learned" digest (internal)
**Effort:** 0.5 day · **Risk:** low.

- [ ] Cron once a week: bottom-10 reranked queries, top-10 hidden
      companies, eval pass-rate trend, p95 latency trend, cost-per-
      search trend.
- [ ] Email to maintainers.

**Definition of done:** the email lands every Monday morning with
real numbers.

---

## Sequencing & decision points

```
Week 1:     P0 (must finish before anything else)
Week 2–3:   P1 (retention loop) — the highest-leverage feature work
Week 3–4:   P2 (search depth) — parallel with P1 once P1.1+P1.2 ship
Week 4–5:   P3 (trust + growth) — parallel with P2
Week 5:     P4 (pricing prep) — gated on cost data from P0.3 + 30 days
                                of EventLog telemetry
Ongoing:    P5 (quality moat)
```

### Decision checkpoints

1. **End of P1 (digest):** open the cron + email to 10 friendly
   users with real saved searches. If < 4 of them re-open the site
   from a digest email within 2 weeks, the digest hypothesis is
   wrong — reconsider before building Pro tier.
2. **End of P2.3 (permalinks):** check Search Console for any
   organic traffic at all to `/job/*` pages. Zero traffic after 4
   weeks means the SEO approach needs rethinking.
3. **End of P4.1 (cost model):** if free-tier marginal cost is >
   $0.50 per active user per month, shrink the free quota before
   any pricing work.
4. **End of P4.3 (pricing doc):** show the pricing tiers to 3
   founder friends. If they can't articulate why Plus exists in
   one sentence, the value prop isn't sharp enough.

---

## Explicitly NOT in this phase

Naming so they don't sneak into scope:

- **Native mobile apps.** Web-first until we have signed-up users.
- **Resume parsing / matching.** Tempting; legal/UX/cost minefield.
- **LinkedIn data.** Not worth the legal risk.
- **AI cover-letter generation.** Commodity feature, doesn't
  differentiate.
- **Recruiter-side product.** Different product entirely.
- **Public API.** Pro tier mentions it but won't ship in this phase.
- **Self-hosted enterprise.** Open-source license + the Docker
  Compose people will figure it out without us building a control
  plane.
- **Multi-LLM provider switching.** DeepSeek works. Switching when
  we have a real reason, not before.

---

## Top 5 to ship this week

If only five things happen:

1. **P0.1** — real-DB contract test. Without this we keep shipping
   migration mismatches.
2. **P0.3** — bundle audit + Web Vitals wired. We can't say "fast"
   without measuring.
3. **P1.1 + P1.2 + P1.3** — cadence model + cron + first digest
   email. The retention feature is the highest-leverage thing on
   this whole document. Slice it small if needed (daily-only,
   ADMIN_EMAIL-only test mode) but ship it end-to-end.
4. **P3.1** — privacy + terms pages. Two days of writing, removes
   legal risk before any real growth attempts.
5. **P4.1** — cost model spreadsheet. We've been guessing about
   margins. Stop.
