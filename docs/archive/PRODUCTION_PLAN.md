# OpenRoleKB — Production & Brand Plan

A concrete, sequenced plan to move OpenRoleKB from "working prototype" to "a startup
people would pay for and trust." Written as a checklist of phased work — each phase
ships independently and unlocks the next.

> Conventions
> - **Owner** lines name the person who should drive that workstream. Leave blank if it's you alone today.
> - **Definition of done** is what an outside observer should be able to verify.
> - **Effort** is calendar time, not raw hours. Assume one full-time builder.
> - Anything tagged 🚀 is "ship this before showing it to a stranger."
> - Anything tagged 💰 directly affects monetization.

---

## Phase 0 — Stop the bleeding (1 week) 🚀

Goal: nothing on the public surface should embarrass you. No regressions, no dead
pages, no broken auth, no production incidents you don't know about.

### 0.1 Apply outstanding fixes
- [ ] Run `npx prisma migrate deploy` so the `SavedSearch_anonId_queryHash_key` and `EventLog.{rerankFailed, cacheMs}` columns exist in every env. Without this, the F9 dedupe is a no-op in prod.
- [ ] Verify all P0/P1 items from `JOB_SEARCH_FIXES.md` actually deployed (Sentry capturing, cache-hit hide-company filter, abort wiring, etc.). Smoke-test on a deployed preview, not just dev.
- [ ] Add a single integration test that hits `/api/search` against a real DB (Postgres in a container) and asserts the full SSE stream — `parsed → results → rerank → done` shape — so we have one end-to-end safety net.

### 0.2 Observability you can answer questions with
- [ ] Sentry: confirm it captures route errors and SSE-stream errors. Add a release marker in CI.
- [ ] Replace ad-hoc `console.log(JSON.stringify({evt: ...}))` with a tiny structured logger (`src/lib/logger.ts`) so every log has `evt`, `level`, `ownerKey`, `route`, `dur_ms`, and a stable schema. Pipe to Axiom / Logtail / Datadog (whichever you'll actually look at).
- [ ] Web Vitals: install `@vercel/speed-insights` (or framework equivalent). Track LCP, INP, CLS per page.
- [ ] An `/admin/health` page that already exists — make sure it shows: cache hit rate (24h), avg parse/exa/rerank/total ms, EventLog write success %, count of `rerankFailed=true` (24h), DB connection pool stats.

### 0.3 Security pass
- [ ] Add CSP, `Strict-Transport-Security`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Content-Type-Options: nosniff` via middleware or `next.config.ts` headers.
- [ ] Rate-limit per IP **and** per anonId on `/api/saved`, `/api/feedback`, `/api/interactions`, `/api/transfer-code`. Today only `/api/search` is well-guarded.
- [ ] Validate `body.filters` from clients with the same `sanitizeFilters` already used for LLM output. Already done for `/api/search` — extend to `/api/saved`.
- [ ] Audit every API route: returns 404 (not 500) for missing rows, never echoes server errors verbatim.
- [ ] Confirm Sentry doesn't ingest user PII (raw query strings can include emails). Add a `beforeSend` filter.
- [ ] Take the `security-review` skill and run it on the current diff.

### 0.4 CI hygiene
- [ ] GitHub Actions: lint + typecheck + test on PRs. Block merge on red.
- [ ] Add `npm audit --production` (or Renovate) for dep updates.
- [ ] Add a preview deployment per PR.

**Definition of done:** A new contributor can clone, `npm install`, `npm test`, `npm run dev`, see green tests and a working app within 10 minutes — and you know within 2 minutes if anything is broken in prod.

---

## Phase 1 — Brand & visual identity (1–2 weeks) 🚀

Today the app reads as "someone's portfolio Next.js project with a clever search bar."
A startup needs a coherent visual identity that a stranger could pick out of a lineup.

### 1.1 Name, mark, voice
- [ ] **Decision:** keep "OpenRoleKB" or pick a punchier consumer name? "OpenRoleKB" reads like an internal tool; consumer brands are usually 1–2 syllables (Roam, Linear, Cron, Arc, Mercury). Spend 2 days brainstorming, register the domain, lock the GitHub org.
- [ ] Wordmark: pair Fraunces (already in) with a stable lockup. Commission a logo or self-design — at minimum a square favicon, an OG card mark, and a 1-line wordmark.
- [ ] Tone-of-voice doc (one page): voice attributes (e.g. "calm, candid, specific, never hype"), 5 example phrasings and 5 anti-patterns. Apply throughout copy.

### 1.2 Polish the Aurora theme
- [ ] Lock the palette as a design-token export: `tokens.json` (Style Dictionary or manual JSON) so Figma + code stay in sync.
- [ ] Add: success / danger / info / warning tokens with explicit dark-mode pairs (currently `success` and `danger` only).
- [ ] Audit every page in both light and dark mode at 320px / 768px / 1280px / 1920px. Take screenshots, fix what looks off.
- [ ] Motion language: a single `transitions.ts` exporting the 3–4 easings + durations actually used (`micro: 120ms`, `entry: 220ms`, `exit: 180ms`, etc.). Stop ad-hoc `duration-120` strings.

### 1.3 Hero & landing
- [ ] Today's home page = "Find a role you'll love" + search bar + sidebar. That works as a tool but doesn't sell. **Add an unauthenticated landing route at `/` and move the search tool to `/search`** OR keep search-first but add a sub-hero strip explaining what makes this different (Exa neural search, LLM rerank, no signup, etc.).
- [ ] Social proof slot: testimonials, "as seen on" logos, or — until you have those — a live counter ("12,347 jobs searched today").
- [ ] OG image + Twitter card. Use a deterministic Vercel OG image so every shared URL gets a branded preview.

### 1.4 Empty / error / loading states
Every state needs personality, not just a spinner and a sad gray sentence.
- [ ] Empty results: friendly suggestion + 3 example queries the user can click.
- [ ] Network error: clear "we couldn't reach search" + retry button (already exists, polish copy + illustration).
- [ ] Loading: replace the shimmer-then-pop with a *visible* progress narrative ("Parsing query… Searching 12 ATS hosts… Ranking matches…"). Anchors expectation, hides latency.

### 1.5 Marketing site separation (optional but lifts perception)
- [ ] Move `/` to a marketing landing under e.g. `/_marketing`. Cache statically. Real product lives at `/app`. Pattern Linear, Cron, Raycast use.

**Definition of done:** A stranger landing on the home page in either color mode can (a) tell you what the product does in under 5 seconds, (b) try it without signing up, and (c) walk away with a clear name and visual impression.

---

## Phase 2 — Core product depth (3–4 weeks)

The current product is one screen. Real users will hit limits within 5 minutes.

### 2.1 Job detail page
- [ ] Today the right pane shows raw description text. Add:
  - Structured "key facts" strip at top: location, remote ok?, posted X days ago, est. salary range (extract from text), company size if findable.
  - "Apply" button + "Save" + "Hide company" + "Bad match" feedback — all in one row.
  - Related roles at the bottom: 3 other jobs from the same query that the user hasn't seen yet.
- [ ] Deep-link individual jobs at `/job/[id]` so users can share. Crawl-and-cache pattern (already half there via `/search/[id]`).

### 2.2 Search experience improvements
- [ ] **Multi-turn refinement.** Today the only way to change a query is to retype. Add: "Refine: too senior" "Refine: only EU" — passes the previous filters + the refinement to the LLM and returns a new filter set.
- [ ] **Filter chips that actually drive the query** (F24 partial — finish it). Removing/editing a chip should hit the API with `filters` and bypass `parseQuery` cleanly.
- [ ] **Saved searches with cadence.** A saved search should be able to re-run automatically (daily / weekly) and email/notify the user on new matches. This is the actual reason someone signs in.
- [ ] **History.** Every search you've ever done, browsable. Stored per-identity. (Don't dedupe; chronology has value.)
- [ ] **Comparison mode.** Select 2–3 jobs → see them side-by-side.

### 2.3 Account & onboarding
- [ ] Onboarding modal first time you save: "What are you looking for?" 3 quick taps (role family, seniority, locations). Pre-seeds 1 saved search.
- [ ] Profile page: name, email, default location + remote preference, notification preferences, account deletion.
- [ ] Account deletion endpoint + cascade purge (already half-there via Prisma `onDelete: Cascade`; add an actual "delete my account" button).
- [ ] Email magic-link sign-in (likely already wired via NextAuth — verify the email template is on-brand).
- [ ] Sign-in friction audit: count clicks from "Save this search" → first email in inbox. If >2 clicks, fix.

### 2.4 Data quality
- [ ] Today rerank scores get written to cache. Track them over time. Detect rubric drift.
- [ ] Add a "duplicate posting" detector: same `(company, title, location)` from multiple ATS hosts → collapse to one card.
- [ ] Job freshness: if `publishedAt` > 30 days ago, badge it as "older." Most users only want fresh roles.
- [ ] Geo-normalize locations: "SF" "San Francisco, CA" "Bay Area" → same thing. Tiny lookup table is enough; don't over-engineer with NLP.
- [ ] Salary extraction: cheap regex over description text. Show range when present.

### 2.5 LLM cost & latency
- [ ] Switch parse+rerank to streaming so first scored result lands faster.
- [ ] Cache parse results per (rawQuery, model) for 24h — these are deterministic at temperature 0.
- [ ] Prompt-tune rerank rubric. Add 10 frozen test cases with expected score ordering, run on every prompt change.
- [ ] Consider moving rerank to a cheaper model (Haiku 4.5, Gemini Flash, GPT-4o-mini) and benchmark blind against the current DeepSeek output.
- [ ] Batch reranks for multiple users on identical queries (Phase 1 of request coalescing — F14 in fix doc).

**Definition of done:** A user who searches once has a reason to come back tomorrow. Saved searches notify them. Profile-aware defaults shorten next query. Job pages are shareable.

---

## Phase 3 — Trust, polish & growth (2–3 weeks)

Things that don't add functionality but make the product feel real.

### 3.1 Legal & trust
- [ ] `/privacy`, `/terms`, `/about` pages. Use a generator (Termly, iubenda) for first draft, edit voice.
- [ ] Cookie consent banner ONLY if you set non-essential cookies. If you don't, write a one-liner explaining you don't track.
- [ ] Public roadmap (GitHub Discussions or a `roadmap.md`). Shows you have a vision.
- [ ] Changelog page (`/changelog`) auto-generated from `CHANGELOG.md`. Linear-style.
- [ ] Contact: `hello@<domain>` with a real inbox you check. Plus a feedback widget (existing FeedbackModal is for jobs; add an app-level one).
- [ ] Status page (`/status` or BetterStack/Statuspage) — uptime + last 90 days.

### 3.2 Performance
- [ ] Lighthouse targets: 95+ on every audit category for `/` and `/search`.
- [ ] Audit bundle: every `lucide-react` import should be tree-shaken. Currently `^1.17.0` is in deps — verify ESM tree-shaking is working.
- [ ] Lazy-load `FeedbackModal`, `SignInModal`, `TransferCodeModal` (currently bundled in initial load).
- [ ] Image CDN for any logos (Vercel OG, Cloudinary, or `<Image>` proper).
- [ ] Make sure SSE response is **not** wrapped by any prox/CDN that buffers (already setting `X-Accel-Buffering: no`).
- [ ] DB: add appropriate indexes for the new query patterns from Phase 2 (saved-search cadence, history). Run `EXPLAIN ANALYZE` on the worst-case queries.

### 3.3 Accessibility
- [ ] Run `axe` against every page. Fix all serious + critical.
- [ ] Keyboard nav: `/`, `j`, `k`, `Enter`, `Esc` should do what users expect. (Already partly wired; complete and document in a `/help` overlay.)
- [ ] Color contrast against Aurora dark mode — verify every text-on-surface combo passes AA at least.
- [ ] Screen reader pass on the SSE-driven results list (announce "X new results" politely).

### 3.4 SEO
- [ ] Per-search-page metadata: title, description, OG, structured data (`JobPosting` schema if we own the job page, else `WebSite` + `SearchAction`).
- [ ] Sitemap including all `/job/[id]` pages.
- [ ] `robots.txt` allowing index of marketing + cached job pages, disallowing search-result URLs (`/search/[id]`).
- [ ] Submit to Google Search Console.

### 3.5 Growth surface area
- [ ] Public "Trending searches today" widget — anonymized, top 10 distinct queries today. Drives social.
- [ ] Embeddable widget: `<iframe src="…">` for company career pages? (Probably defer until traction.)
- [ ] Newsletter integration: weekly "Roles you might love" digest powered by the user's saved searches. (Tie to 2.2 saved-search cadence.)
- [ ] Referral mechanic: "Invite a friend, both get 30 days of premium." (Tie to 4.)
- [ ] Browser extension: highlight any job posting and add to saved? Defer until you've validated demand.

**Definition of done:** Someone could write a positive Hacker News post about this and you'd be ready for the traffic.

---

## Phase 4 — Monetization & sustainability (parallel from Phase 2 onwards) 💰

You need a business model before LLM costs eat you alive.

### 4.1 Cost ceiling
- [ ] Per-user cost model spreadsheet. Inputs: avg searches/day, Exa $/search, DeepSeek tokens/search. Output: max sustainable free-tier searches.
- [ ] Daily budget alarms: if Exa or DeepSeek bill exceeds X, page yourself and short-circuit free tier to cache-only.

### 4.2 Pricing tiers
Default proposal (steal/adjust):
- **Free** — 30 searches/month, 5 saved searches, no email digest, ads-supported (or not).
- **Plus ($8/mo)** — Unlimited searches, unlimited saved, daily email digest, comparison mode, browser extension.
- **Pro ($24/mo)** — Plus + agentic search ("set up an interview pipeline for me"), priority rerank model, API access.

### 4.3 Payments
- [ ] Stripe (already mature) over Polar.sh / Lemon Squeezy. Configure tax handling (Stripe Tax).
- [ ] Customer portal: cancel, switch tier, see invoices. Stripe-hosted.
- [ ] Trial mechanic: 14-day Plus trial, no card required, downgrades to Free.

### 4.4 Affiliate / commerce angle
- [ ] Many ATS sources have affiliate programs for recruiters. Investigate but don't take affiliate money in a way that biases rerank — keep it transparent.
- [ ] Sponsored listings: NEVER mix with rerank scores. If you do this, it goes in a clearly labeled "Sponsored" rail above or below organic.

**Definition of done:** You have at least one paying user. You can name your gross margin per search.

---

## Phase 5 — Founding-team readiness (ongoing)

If this becomes a startup, what does the company look like?

### 5.1 Repo hygiene for outside contributors
- [ ] `CONTRIBUTING.md` with environment setup, how to run tests, how to make a PR.
- [ ] `ARCHITECTURE.md` summarizing the modules at a level new engineers can ramp on in a day.
- [ ] Drop the multiple `mvp2_*.md` planning docs from the repo root once they're stale — move to `docs/archive/`.
- [ ] Stop committing `.commandcode/` and other tool dirs (add to `.gitignore`).
- [ ] `LICENSE` is currently MIT (good for open source). Decide if the product is open-core or proprietary. If proprietary, switch to a source-available license (BSL, FSL) before any real revenue.

### 5.2 Hiring readiness
- [ ] An "interview problem" doc: 3 problems that mimic the kind of work the next engineer will do. Tests prompt-engineering, full-stack instincts, and judgment.
- [ ] A 1-pager pitch deck (Notion or slides). Five slides: problem, audience, demo, why-this-team, ask.
- [ ] Founding-engineer offer template + equity range. Even if you don't hire for 6 months, write it down now while the cap table is simple.

### 5.3 Data & moat
- [ ] The product's actual moat is `EventLog` + `FeedbackEvent` + `JobInteraction` over time. Make sure those tables are backed up daily.
- [ ] Build a once-a-month "what we learned" dashboard: which queries get the worst rerank scores, which companies users hide most, which jobs get the most clicks. This is the only competitive advantage you'll have over a 16-yo with the same API keys.

### 5.4 Pre-mortem
Schedule a "what kills us" review every quarter. Sample failure modes to plan for:
- DeepSeek or Exa raises prices 5×.
- LinkedIn / Indeed pursue ATS scrapers and Exa quietly drops them.
- A bigger entrant (Greenhouse itself, LinkedIn, Levels.fyi) ships the same thing.
- A regulator decides cross-border job aggregation needs a license.
For each, write down what you'd do in 48 hours.

---

## What we're explicitly NOT doing (yet)

Naming these so they don't sneak into scope:

- Native mobile apps. Web-first until traffic justifies it.
- ATS integrations (Greenhouse-as-data-source). Stay on the search side until product-market fit.
- Resume parsing / matching. Tempting feature, huge can of worms (legal + UX + cost).
- LinkedIn data. Not worth the legal risk.
- AI-generated cover letters. Commodity feature, doesn't differentiate.
- A "for recruiters" side of the marketplace. Different product entirely.

---

## Sequencing & decision points

```
Week 1:        Phase 0 (must finish before anything else)
Week 2–3:      Phase 1 (brand + landing) ─┐
Week 2 onward:                            ├─ run Phase 4.1 (cost model) in parallel
Week 4–7:      Phase 2 (product depth)    │
Week 5–6:      Phase 3 (polish) ──────────┘ (overlap with 2 once visual identity locked)
Week 8+:       Phase 4 (monetization launch)
Ongoing:       Phase 5 (founding-team readiness)
```

### Decision checkpoints

1. **End of Phase 1 (brand):** show the new landing + dark mode + search to 5 strangers. If 4/5 can't describe the product after 30 seconds, the brand/landing need another iteration before product depth.
2. **End of Phase 2 (depth):** measure 7-day retention. Need >25% to justify monetization spend.
3. **End of Phase 4.1 (cost model):** if free-tier unit economics are >$0.50/user/month, raise prices or shrink the free tier *before* launching paid.
4. **End of Phase 4 (paid live):** 10 paying users in 30 days = signal to fundraise / hire. Less = re-evaluate audience.

---

## Top 5 things to do *this week* (if you only do five things)

1. Apply the outstanding Prisma migration. F9/F7 don't work without it.
2. Wire Sentry release markers + structured logs. Without observability, nothing else is safe.
3. Pick the brand name + register the domain. Phase 1 blocks on this.
4. Add `/privacy` and `/terms`. Two days of writing, removes a perception risk.
5. Ship Phase 2.2's saved-search cadence + email digest. This is the single feature most likely to convert "tried it once" into "uses it weekly." If users don't come back, nothing else in this plan matters.
