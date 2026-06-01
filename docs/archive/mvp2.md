# OpenRoleKB — MVP2 Plan

## Where MVP1 landed

The repo currently runs the full pipeline end-to-end: NL parse → cache lookup → Exa neural search → DeepSeek rerank → SSE stream → two-pane reading UI with theme toggle, mobile sheet, saved-search pills. Everything called out in `DESIGN.md` is in the codebase, and `FIXES.md` items #3, #4, #6, #7, #8 are resolved (real `cacheId`, replay matches first run, autoprompt off, company extracted from URL, anti-buffering header). Saved searches work via anonymous `localStorage` UUID.

What's missing is everything that makes the product *sticky and trustworthy*: there is no reason for a user to return tomorrow, no per-job state ("did I already look at this?"), no feedback loop teaching the reranker, no observability when something goes wrong, no tests. MVP2 closes those gaps.

## Goals

1. **Continuity** — let users keep their saved state across devices and sessions (auth, anon→user merge, transfer code).
2. **Personalization** — let users mark, hide, and track jobs across sessions.
3. **Quality** — make rerank feedback observable, expand result coverage, surface freshness.
4. **Operations** — basic tests, observability, cache hygiene, error budgets.

Out of scope (still): apply tracking with resume parsing, mobile native, pagination beyond ~50 results, multi-language UI, payments.

**Explicitly cut from MVP2 (was considered, deferred):** email alerts on saved searches. The cron + diff + unsubscribe + email-template scope was the single biggest risk in the plan, and we'd rather ship the rest sooner. Reconsider for MVP3 once we see whether retention from transfer-code + per-job state is enough.

## Non-goals (call out so we don't drift)

- **No social features.** No comments, no public profiles, no shared lists.
- **No employer side.** This is a candidate-facing search tool. Job posters interact via the ATS hosts we link out to.
- **No scraping deeper than Exa returns.** Detail pane keeps using Exa's `text` excerpt + a deep link.

---

## 1. Auth: magic link, no passwords

### 1.1 Why
Anonymous browser ID is a dead end for cross-device use — clearing cookies wipes saved searches, and a phone and laptop can't share state. Keep onboarding to one field (email) and one click (the link). Anyone who doesn't sign in stays in anon mode; nothing breaks.

**Anon expiry (decided):** anon saved searches and per-job interactions auto-expire 30 days after their most recent activity unless a user signs in and claims them. Forces the sign-in nudge to land before all saved state evaporates, and keeps the DB from growing unboundedly with cookies that will never come back. Implemented as part of the daily cache-purge cron — see implementation plan Phase 2.

**Cross-device transfer code (decided):** in addition to magic-link sign-in, support a one-shot "transfer code" — generate a 6-character code on device A, type it on device B within 10 minutes, the second device adopts the first device's `anonId`. Lets a user move from laptop to phone without an email account, and naturally bridges into the auth flow when they're ready. See §2 below and implementation plan Phase 6.

### 1.2 Provider
Use **Auth.js (NextAuth) v5** with the `Email` provider and a Postgres adapter (the Prisma adapter is fine — same DB). Email send via **Resend**: the free tier covers MVP traffic, the SDK is one function call, and DKIM/SPF setup is documented. If Resend is unavailable, fall back to SMTP via the same Auth.js provider.

### 1.3 Data model

Auth.js needs `User`, `Account`, `Session`, `VerificationToken` (standard schema; copy from the Auth.js Prisma docs). Add an `anonId` column on `User` so we can merge anon state at sign-in.

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  image     String?
  anonId    String?  @unique  // backfilled at first sign-in from x-anon-id
  createdAt DateTime @default(now())
  // ... auth.js relations
}
```

`SavedSearch` gains an optional `userId`; existing `anonId` rows stay for anon users. New writes for signed-in users go to `userId`. At sign-in, run a one-shot merge: rows with the user's prior `anonId` get `userId` set and `anonId` cleared.

### 1.4 UI
- Header gets a `Sign in` button (text style, replaces the placeholder `About` link). When signed in: avatar circle (initial fallback) + dropdown with `Saved searches`, `Settings`, `Sign out`.
- Sign-in modal: single email field, "We'll email you a link." After submit: "Check your inbox." No password reset, no error-prone flows.
- The existing anon flow is preserved — saving a search without signing in still works. A subtle inline nudge appears on the second save in a session: "Sign in to keep these across devices."

### 1.5 API
- `POST /api/auth/[...nextauth]` — Auth.js routes.
- `POST /api/search` and `POST /api/saved` accept either an authenticated session OR an `x-anon-id` header. Server resolves a single `ownerKey` used downstream so handlers don't branch.

---

## 2. Cross-device transfer for anon users

### 2.1 Why
Most anon users browse on desktop, then want to flip to phone in bed without setting up an account. A short transfer code beats forcing them through magic-link auth on a phone keyboard. Anon users with at least one saved search or job interaction can press `Transfer to another device` and get a 6-character code shown on screen.

### 2.2 Flow
1. User on device A clicks `Transfer to another device` in the header dropdown (visible only when there's anon state to transfer).
2. Server generates a 6-char code (alphanumeric, excluding ambiguous chars `0OIl1`), stores `{ code, anonId, expiresAt }` in a new `TransferCode` table with a 10-minute TTL.
3. Device B opens the home page, clicks `Have a transfer code?`, types the code.
4. Server validates the code, swaps device B's local `anonId` for device A's `anonId` (so all the saved-search and interaction rows resolve), deletes the code.
5. Both devices now read from the same anon state. Either can promote to a real account later via §1; the merge in §1.4 handles either device's anonId.

### 2.3 Data model

```prisma
model TransferCode {
  code      String   @id        // 6 chars
  anonId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([expiresAt])
}
```

Codes are single-use. Once redeemed, the row is deleted in the same transaction as the anonId swap.

### 2.4 Rate limit
Generation: 3 codes per anonId per hour. Redemption: 5 attempts per IP per minute. Both via the existing Upstash limiter (§5.4).

---

## 3. Per-job state: save, hide, applied

### 3.1 Why
The detail pane already has design slots for `Save ⭐`, `Hide this company`, and `Tell us this match was off`. None of them persist anything. Per-job state is one of the strongest retention signals on offer: once a user has hidden five companies they don't want, they're invested.

### 3.2 Data model

```prisma
model JobInteraction {
  id        String   @id @default(cuid())
  ownerKey  String   // userId for signed-in users, anonId otherwise
  jobId     String
  kind      String   // "saved" | "hidden" | "applied" | "dismissed"
  note      String?  // freeform, e.g. "applied 2026-06-02"
  createdAt DateTime @default(now())

  job  Job @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@unique([ownerKey, jobId, kind])
  @@index([ownerKey, kind])
}

model HiddenCompany {
  id        String   @id @default(cuid())
  ownerKey  String
  company   String   // matches Job.company exactly (lowercased)
  createdAt DateTime @default(now())

  @@unique([ownerKey, company])
  @@index([ownerKey])
}
```

`Job` keeps the back-relation. `ownerKey` is the unified key from §1.5 — survives the anon→user merge by being rewritten in the same transaction.

### 3.3 API
- `POST /api/interactions` `{ jobId, kind, note? }` — upsert.
- `DELETE /api/interactions?jobId=…&kind=…` — remove.
- `POST /api/hidden-companies` `{ company }`.
- `DELETE /api/hidden-companies?company=…`.
- `GET /api/me/saved-jobs` — list of `JobInteraction` with `kind=saved`, joined to `Job`. Powers a new `/saved` page.

### 3.4 UI
- `ResultRow.tsx`: small icon row at bottom-right of each result — saved (filled star if true), hidden-company (eye-off), applied (checkmark). Clicking toggles. Hidden companies are filtered out client-side from results (server already returned them).
- `DetailPane.tsx`: wires the existing secondary action buttons. `Hide this company` adds to `HiddenCompany` and removes the row from the visible list immediately. `Save ⭐` adds a `saved` interaction.
- New `/saved` page: a grid of saved jobs, sorted by `JobInteraction.createdAt desc`, with the same `ResultRow` styling. Empty state reuses the mascot.
- Header dropdown links to `/saved` for signed-in users (also visible for anon if they've saved 1+ jobs).

### 3.5 Server-side hide filter
On `/api/search`, after rerank, filter out any `Job.url` whose `extractCompany(url)` matches a hidden-company entry for the requesting `ownerKey`. Do this *after* rerank so the rubric isn't biased by hides.

---

## 4. Quality: feedback, freshness, more sources

### 4.1 Thumbs-down feedback
The detail pane footer already has a `Tell us this match was off →` link. Wire it.

```prisma
model FeedbackEvent {
  id        String   @id @default(cuid())
  ownerKey  String
  jobId     String
  kind      String   // "wrong_role" | "wrong_seniority" | "wrong_location" | "stale" | "other"
  rawQuery  String
  filters   Json
  rerankScore Float?
  fit       String?
  comment   String?
  createdAt DateTime @default(now())

  @@index([kind, createdAt])
}
```

A 1-question modal: radio of canned reasons + optional comment. POST to `/api/feedback`. We *don't* immediately retrain anything — this is a logging surface so we can spot patterns. Add a `/admin/feedback` route gated by a single `ADMIN_EMAIL` env var (Auth.js session check) for browsing recent events. Promote to a `User.role` enum if a second admin is ever needed.

### 4.2 Freshness signal in the UI
`Job.publishedAt` is already populated. ResultRow doesn't show it; DetailPane doesn't show it consistently. Add:
- ResultRow: a third line ending with "· 4d ago" (relative).
- DetailPane: "Posted 4 days ago" (already in DESIGN.md, may already be done — verify).
- ResultsList: a sort toggle `Best match | Newest`. Newest sorts by `publishedAt desc` (treating null as oldest).

### 4.3 Pagination
Bump Exa `numResults` to 50, render the first 25, and add a `Show more` button at the bottom of the list. Cheaper than implementing real Exa offsets and good enough until traffic warrants it. Cache the full 50.

### 4.4 More ATS sources
The current `ATS_DOMAINS` list is solid but missing several common hosts. Audit and add (verify each returns useful results before shipping):
- `myworkdayjobs.com` — Workday-hosted (very high volume, but messy URLs)
- `smartrecruiters.com`
- `bamboohr.com`
- `recruitee.com`
- `personio.de` (EU coverage)
- `teamtailor.com`
- `jobs.eu.lever.co` patterns (may already be covered)

For each, extend `lib/company.ts` with a URL parser. Add a small fixture test (`scripts/test-company.ts`) covering 2-3 real URLs per source.

### 4.5 Better location extraction
`Job.location` is currently always `null` because Exa doesn't reliably return it. Two options:
- **Cheap:** parse the `text` excerpt for `"Location:"` / `"Based in"` strings with a regex pass. Good enough for 60% of postings.
- **Better:** add a tiny DeepSeek call in `cacheSearch` that extracts `{location, isRemote}` per posting. Costs ~$0.0001/posting × 25 per fresh search → tolerable. Cache the result on the `Job` row.

Pick the cheap version for MVP2; revisit if location-filtered queries underperform.


---

## 5. Operations

### 5.1 Tests
None exist today. Add the smallest useful net:

- **Unit:** `lib/company.ts` URL parsing (one fixture per ATS), `lib/hash.ts` query normalization, `lib/rate-limit.ts` token bucket math (the FIXES.md #9 issue).
- **Route:** `/api/search` happy path with mocked `searchJobs` and `rerank`. Verify SSE event order: `parsed`, `results`, `rerank`, `done` — and `done` carries a non-null `id`.
- **Route:** `/api/saved` CRUD with both an `anonId` header and a session.
- **Route:** `/api/transfer-code` create + redeem (single-use, expired-code rejection).

Use **Vitest** (Next 16 docs prefer it over Jest) with the `next/jest` preset off — keep test environment node-only for route handlers, `jsdom` only for component tests later. Skip component tests for MVP2; route + lib coverage is enough.

### 5.2 Observability
- **Errors:** Sentry (free tier) wired at the route boundary plus `globalThis.onunhandledrejection`. Tag events with `route`, `userId|anonId`, `cacheHit`. Don't log raw queries (PII risk if users paste resumes).
- **Metrics:** counter for `search.cache_hit | search.cache_miss | rerank.error | exa.error`. Vercel Analytics or a single `console.log` JSON line per request — pick whichever lands in the same place as Sentry breadcrumbs.
- **Latency:** record `parse_ms`, `exa_ms`, `rerank_ms`, `total_ms` per fresh search. Surface in a `/admin/health` page (admin-gated) showing the last 100 searches.

### 5.3 Cache hygiene
The plan said "purge daily, rows older than 7 days." Add it now:
- `GET /api/cron/cache-purge` — `DELETE FROM SearchCache WHERE createdAt < now() - interval '7 days'`. Same `x-cron-secret` gate.
- Vercel cron entry: daily at 02:00 UTC.
- Also purge orphaned `Job` rows: any `Job` not referenced by a `SearchCache.resultJobIds` array AND not referenced by a `JobInteraction`. Keep batches small.

### 5.4 Rate limiting
The current in-memory bucket dies on cold starts and doesn't share across regions. Move to **Upstash Redis** (free tier) with `@upstash/ratelimit`. Same shape, different store. Keep the limit at 10/min per IP; add a 100/day limit per `ownerKey` so a single signed-in user can't trash the Exa quota.

### 5.5 Outstanding FIXES.md cleanup
While you're in there: items #5 (LinkedIn path filter), #9 (rate-limit math — moot once Upstash lands but worth grokking), #10 (lint cleanup). All small.

---

## 6. Schema migration order

Critical: each migration is independently deployable. Don't bundle.

1. **`add_job_interactions`** — `JobInteraction`, `HiddenCompany`, `Job` back-relation.
2. **`add_feedback_events`** — `FeedbackEvent`.
3. **`add_user_auth`** — `User`, `Account`, `Session`, `VerificationToken`, `SavedSearch.userId` (nullable), `SavedSearch.queryHash` (for dedupe). Risky — once users exist, rollback loses signups.
4. **`add_transfer_code`** — `TransferCode` table.
5. **`add_job_location_remote`** — `Job.isRemote` (nullable). `Job.location` already exists.
6. **`add_event_log`** — `EventLog` for `/admin/health`.

After each migration, deploy the corresponding feature behind a server-side flag (`process.env.MVP2_AUTH=on`, etc.) so a rollback is just "flip the flag off and redeploy." Once all six are stable in prod, remove the flags.

Migrations 4-6 depend on #3 (`User` table) being verified first.

---

## 7. Build order (suggested commit cadence)

Each step is independently testable end-to-end. Don't move on until it works in the browser or in CI.

1. **Tests scaffold** (~2h). Vitest config, fixture loader, one passing test per `lib/*` file. Forces test-friendly factoring before features pile on.
2. **Cache purge cron + rate limit move** (~2h). Pure ops, low risk, retires FIXES debt.
3. **Per-job interactions: data + API + UI** (~6h). Wire the `Save ⭐` and `Hide company` buttons to real endpoints; show saved-state on result rows; ship `/saved` page. Works for anon users immediately.
4. **Feedback modal + admin view** (~3h). 1-question modal + `FeedbackEvent` model + `/admin/feedback` list. No retraining yet.
5. **Auth.js + Resend + sign-in modal** (~5h). Anon flow stays. Anon→user merge runs on first sign-in. (Resend is for the magic-link send only — no other email infra in MVP2.)
6. **Cross-device transfer code** (~2h). `TransferCode` table, generate + redeem endpoints, header-dropdown UI, redemption page. Slots in after auth so the merge flow already exists for anonId rewrites.
7. **Quality pass** (~4h). Pagination to 50 with `Show more`, freshness line on `ResultRow`, sort toggle, ATS allowlist additions.
8. **Observability** (~3h). Sentry, latency metrics, `/admin/health`.

Total: ~27h of focused work. The biggest risk item is #5 (any auth integration grows tentacles); budget 1.5x.

---

## 8. Verification

Before calling MVP2 done, all of these should pass:

1. **Anon → signed-in continuity**: save a search anonymously, sign in with email, the saved search appears under the new account; the previous anon localStorage key no longer matters.
2. **Cross-device transfer**: anon-save a search on device A, generate a transfer code, redeem on device B within 10 minutes, confirm both devices see the same saved state. Re-redemption with the same code returns 404.
3. **Hide-company is silent and fast**: hide a company from the detail pane, run a query that previously returned that company, verify zero rows from that company appear and the rerank order of remaining rows is unchanged.
4. **Cache purge is non-destructive**: run the purge cron with a 7-day-old fixture row, confirm the row is gone, confirm a 6-day-old row remains, confirm `JobInteraction` rows referencing soft-old `Job` rows still resolve.
5. **Rate limit is regional-safe**: hit `/api/search` 11 times in a minute from one IP across two Vercel regions, verify the 11th returns 429.
6. **Pipeline observability**: a forced `EXA_API_KEY` rotation (set to garbage) results in a Sentry event with `route=/api/search`, `phase=exa`, and the user-facing UI shows the existing error banner — no white screen, no leaked secret in the message.
7. **Test suite**: `npm test` passes; coverage for `lib/*` ≥80% line.
8. **Lighthouse / Axe**: still ≥95 accessibility on home and `/?q=…`. New `/saved` and admin pages also pass Axe with no critical issues.

---

## 9. What MVP3 might look like (not committing)

These are deliberately deferred so MVP2 stays scoped:

- **Email alerts on saved searches.** Was the highest-leverage retention move on the original plan but cost too much scope (cron + diff + email template + unsubscribe + Resend onboarding + spam-filter shakedown). Revisit once we know whether transfer-code + per-job state lifts retention enough on their own.
- **Resume-aware search.** Upload a resume, parse to a baseline filter set, weight rerank toward matching skills.
- **Apply tracker.** A real Kanban (`saved | applied | interview | offer | rejected`) for each user.
- **Employer-side seeding.** Allow companies to push job postings directly, bypassing Exa for their own roles.
- **Better dedup.** Same role posted on Greenhouse + LinkedIn currently appears twice. Cluster by `(company, normalized_title, location)` and pick the canonical source.
- **Personalized rerank.** Once we have ≥10 thumbs-down events per user, lightly weight the rerank rubric with their preferences.

