# MVP2 — Changes from Original Plan

This document records all changes made to `mvp2.md` and `mvp2_implementation_plan.md` after the initial draft, based on user decisions and technical review.

---

## High-level scope changes

### Removed: Email alerts on saved searches

**What was cut:**
- Entire Phase 6 "Saved-search alerting" (~6h, 1.5× risk)
- `SavedSearch.alertCadence`, `lastAlertAt`, `lastSeenUrls` columns
- `/api/cron/alerts` route + worker logic
- `lib/alerts.ts`, `lib/email.ts`, `lib/sign.ts` (HMAC unsubscribe)
- Cadence dropdown UI on saved-search pills
- Unsubscribe page (`/unsubscribe/[token]`)
- Vercel cron entries for daily/weekly alerts
- Email template + Resend integration for alert sends

**Why:**
The cron + diff + email-template + unsubscribe + spam-filter-shakedown scope was the single biggest risk in the plan. Cutting it saves ~9h of risk-adjusted work and lets us ship the rest sooner. Reconsider for MVP3 once we see whether retention from transfer-code + per-job state is enough.

**Impact on other features:**
- Auth still uses Resend, but only for magic-link sign-in emails (simpler, predictable volume)
- `RESEND_FROM` env var repurposed: `alerts@openrolekb.app` → `hello@openrolekb.app`
- No `lastSeenUrls` diffing logic needed anywhere

### Added: Cross-device transfer code

**What was added:**
- New Phase 6 "Cross-device transfer code" (~2h, 1.1× risk)
- `TransferCode` table (6-char codes, 10-min TTL, single-use)
- `/api/transfer-code` (generate) + `/api/transfer-code/redeem` routes
- `lib/transfer-code.ts` code generator (30-char alphabet, ambiguous chars removed)
- Transfer UI in header dropdown:
  - Generate modal: shows code + copy button + countdown
  - Redeem modal: 6-char input (auto-uppercase, paste-friendly)
- Rate limits: 3/hour per anonId (gen), 5/min per IP (redeem)
- Cleanup: expired codes purged by existing cache-purge cron

**Why:**
Solves the cross-device problem (laptop → phone) without forcing users through email auth on a phone keyboard. Anon users can transfer state in 30 seconds. Once either device signs in, the merge flow (already built for auth) handles the anonId retirement.

**How it works:**
1. Device A generates a 6-char code, server stores `(code, anonId, expiresAt)` with 10-min TTL
2. Device B redeems the code, server returns the source `anonId`
3. Device B overwrites its `localStorage.openrolekb_anon_id` with the returned value
4. Both devices now read/write the same anon state (no server-side data moves)
5. Code is single-use — deleted on first redemption

**Net impact:**
- Time: -4h raw, -9h risk-adjusted
- Total: 32h → 27h raw, 42h → 33h risk-adjusted
- Working days: ~10 → ~8

---

## User decisions (Q1-Q5)

### Q1: Does anon flow expire?
**Decision:** ✅ Yes — 30 days of inactivity.

Anon `SavedSearch`, `JobInteraction`, and `HiddenCompany` rows are purged 30 days after their most recent `createdAt` (or `updatedAt` if added). Implemented as additional sweeps in the cache-purge cron (Phase 2 §2.1).

**Recorded in:**
- `mvp2.md` §1.1
- `mvp2_implementation_plan.md` §12 Q1

### Q2: Cross-device sync without sign-in?
**Decision:** ✅ Yes — transfer code (Phase 6).

6-char single-use codes, 10-minute TTL, 3/hour generate limit per anonId, 5/min redeem limit per IP.

**Recorded in:**
- `mvp2.md` §1.1, §2 (entire section)
- `mvp2_implementation_plan.md` §12 Q2, Phase 6 (entire phase)

### Q3: Email digest vs. immediate alerts?
**Decision:** ✂️ Cut from MVP2 along with the entire alerts feature.

Revisit in MVP3.

**Recorded in:**
- `mvp2.md` §Goals (explicit cut callout), §9 MVP3 (deferred list)
- `mvp2_implementation_plan.md` §12 Q3

### Q4: `ADMIN_EMAILS` vs. a real role column?
**Decision:** ✅ Single `ADMIN_EMAIL` env var.

One person reads `/admin/feedback` and `/admin/health`. Promote to a `User.role` enum the moment a second admin is needed — not before.

**Recorded in:**
- `mvp2.md` §4.1
- `mvp2_implementation_plan.md` §0.1 env vars, Phase 4 §4.2 code snippet, §12 Q4

### Q5: Alert email branding?
**Decision:** ✂️ Cut.

No alert emails in MVP2. Resend is used only for the magic-link sign-in template, which can stay plain.

**Recorded in:**
- `mvp2_implementation_plan.md` §12 Q5

---

## Technical decisions (§14 in implementation plan)

### 14.0: Auth.js v5 with Prisma 7 — verify, then vendor

**Problem:** `@auth/prisma-adapter` peer-dep range is `^4 || ^5 || ^6`. The repo is on Prisma 7. May work at runtime (adapter touches stable API subset) or may break on generated-types mismatch.

**Decision:** Verify compatibility in Phase 1 with a 30-minute smoke test. If it works, proceed as planned. If it doesn't, vendor a custom adapter rather than downgrading Prisma.

**Action in Phase 1:**
```bash
npm install next-auth@beta @auth/prisma-adapter
# write a 20-line script that imports PrismaAdapter(prisma) and calls
# adapter.createUser({ email: "test@example.com" }) against a scratch DB
# pass: proceed. fail: implement vendored adapter at src/lib/auth-adapter.ts
```

Time-box 30 min. If vendoring is needed, budget +2h on Phase 5.

**Why:** Prisma 7 was a deliberate stack choice. The Auth.js adapter interface has ~14 methods, most one-liners. Inlining is cheaper than fighting peer-dep ranges, and a vendored adapter survives future Auth.js minor bumps.

### 14.1: Owner-key normalization (Phase 3 + Phase 5)

**Problem:** `ownerKey` is a free-form `String` column. A casing or formatting drift (uppercase UUID, missing dashes) silently corrupts indexes and breaks `@@unique` constraints on `JobInteraction`.

**Decision:** All `ownerKey` writes go through a single `normalizeOwnerKey()` helper. Invalid input rejects at the route boundary with 400.

**File:** `src/lib/owner.ts` (already created in Phase 3) — add:

```ts
export function normalizeOwnerKey(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  // anonId (UUID v4) or cuid (Auth.js User.id format)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) return trimmed;
  if (/^c[a-z0-9]{24}$/.test(trimmed)) return trimmed;
  return null;
}
```

`getOwnerKey()` returns the normalized form. Every writer (`/api/interactions`, `/api/hidden-companies`, `/api/feedback`) calls it, returns 400 on `null`.

**Why:** Cheap to enforce, expensive to backfill later.

### 14.2: SavedSearch dedupe at merge time (Phase 5)

**Problem:** If an anon user saves "react remote", then signs in to an account that already has "react remote" saved, the merge will duplicate the `SavedSearch` row (no unique constraint on `(userId, rawQuery)`). The saved-strip UI shows two identical pills.

**Decision:** Add `@@unique([userId, queryHash])` to `SavedSearch` (and a parallel anon constraint via partial index on `(anonId, queryHash) WHERE anonId IS NOT NULL`). On merge, duplicates are silently skipped.

**Schema delta** (rolls into `add_user_auth` migration):

```prisma
model SavedSearch {
  // ... existing
  queryHash String   // sha256(normalizedQuery + filters), stable
  @@unique([userId, queryHash])
  @@index([anonId, queryHash])
}
```

Plus a raw-SQL migration for the partial unique index:
```sql
CREATE UNIQUE INDEX saved_search_anon_unique 
ON "SavedSearch"("anonId", "queryHash") 
WHERE "anonId" IS NOT NULL;
```

**Backfill:** Existing rows compute `queryHash` once. Run as part of the migration.

**Why:** Use `queryHash` (already produced by `lib/hash.ts`) instead of `rawQuery` so case and whitespace differences collapse. With the constraint, the merge silently keeps one row. Without it, the UI is confusing.

### 14.3: Hidden-company casing (Phase 3 + Phase 7)

**Problem:** `extractCompany` returns the URL slug verbatim (`"acmerobotics"`, `"superhuman"`). Workday URLs use a different casing convention (`acmeRobotics`). If the comparison isn't case-insensitive, the hide filter silently fails.

**Decision:** Lowercase on both write and read. Phase 7 adds one fixture per ATS host with a known-tricky-casing example.

**Where it lands:**
- `extractCompany(url)` returns whatever the URL has. Unchanged.
- Every `HiddenCompany.company` write uses `.toLowerCase()`.
- The hide filter in `/api/search` compares `extractCompany(r.url)?.toLowerCase()` against the stored lowercase set. Already specified in Phase 3 §3.4.
- Phase 7 §7.5 adds one casing-edge-case fixture per new ATS host (Workday, SmartRecruiters, BambooHR, Recruitee, Personio, Teamtailor).

**Why:** Cheap to enforce, expensive to debug later when a user reports "I hid Acme but it still shows up."

### 14.4: `/api/me/saved-jobs` does NOT filter hidden companies (Phase 3)

**Problem:** If a user saves a job, then later hides the company, should the `/saved` page still show it?

**Decision:** Yes. The `/saved` page shows everything the user explicitly saved, even if the company is now hidden. Saved overrides hide.

**Where it lands:** `src/app/api/me/saved-jobs/route.ts` gets a one-line code comment:

```ts
// Intentional: saved jobs are NOT filtered by HiddenCompany. User explicitly
// saved this; their later hide of the company should not retroactively erase it.
```

**Why:** The user took an explicit action ("save this job"). Silently hiding it later because they hid the company elsewhere is surprising and unrecoverable from their POV. Hide is a search-results filter, not a global blacklist.

### 14.5: Rate-limit helpers split by purpose (Phase 6)

**Problem:** The original `rateLimit(req, ownerKey?)` couldn't express "3/hour per anonId for code generation" without baking the bucket config in. Phase 6's transfer-code routes need dedicated limiters.

**Decision:** `lib/rate-limit.ts` exports named limiters per use case rather than one generic function.

**File:** `src/lib/rate-limit.ts` — add:

```ts
const transferGen = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(3, "1 h"),
  prefix: "rl:xfer-gen",
});

const transferRedeem = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(5, "60 s"),
  prefix: "rl:xfer-redeem",
});

export async function rateLimitTransferGen(anonId: string) {
  const r = await transferGen.limit(anonId);
  return { ok: r.success };
}

export async function rateLimitTransferRedeem(ip: string) {
  const r = await transferRedeem.limit(ip);
  return { ok: r.success };
}
```

Phase 6 §6.3 routes call these, not the generic `rateLimit`.

**Why:** Named exports are clearer at the call site and harder to misuse.

### 14.6: Sentry sampling + PII redaction (Phase 8)

**Problem:** Sentry's defaults (1.0 `tracesSampleRate` everywhere) blow up the free quota fast in prod. PII in tags (`email`, `rawQuery`) is indexed and searchable — even a one-time leak survives in their database long-term.

**Decision:** Explicit `tracesSampleRate` per environment, `beforeSend` hook that scrubs PII fields. Add a one-line PR-template checklist item: "no `email` or `rawQuery` in Sentry tags."

**File:** `sentry.server.config.ts` (created by the wizard) — append:

```ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  beforeSend(event) {
    // Strip PII that might leak into tags or extras
    const SCRUB_KEYS = ["email", "rawQuery", "comment", "anonId"];
    if (event.tags) for (const k of SCRUB_KEYS) delete event.tags[k];
    if (event.extra) for (const k of SCRUB_KEYS) delete event.extra[k];
    if (event.user?.email) event.user.email = "[redacted]";
    return event;
  },
});
```

Same shape in `sentry.client.config.ts`. The `beforeSend` is a backstop — primary defense is the Phase 8 §8.1 rule: don't pass PII to `captureRouteError` in the first place.

**Why:** 0.1 sampling in prod keeps quota under control. The scrubber prevents accidental leaks.

### 14.7: Prisma type barrel (Phase 1, applied as touched)

**Problem:** The generator outputs to `../../generated/prisma/client`. Future migrations may move it. Every new file that imports `Prisma` types needs the relative path.

**Decision:** Re-export the `Prisma` namespace from `src/lib/prisma.ts` so new code imports from `@/lib/prisma` instead of `../../generated/prisma/client`. Existing `cache.ts` import stays — don't mass-rename.

**File:** `src/lib/prisma.ts` — append:

```ts
export type { Prisma } from "../../generated/prisma/client";
```

Then in new files (Phase 3 onwards):

```ts
import { prisma, type Prisma } from "@/lib/prisma";
```

**Why:** One barrel is one place to fix if the generator path changes. Also: `@/lib/prisma` is the canonical Prisma access point in this repo, and types should follow the same path.

---

## Changes by section

### mvp2.md

#### §Goals
- **Changed:** "Retention" → "Continuity" (auth + transfer-code + merge, not alerts)
- **Added:** Explicit cut callout: "email alerts on saved searches" deferred to MVP3

#### §1 Auth
- **Changed (§1.1):** Anon expiry decision recorded (30 days), cross-device transfer decision recorded (yes, via §1.6)
- **Changed (§1.4):** UI nudge copy: "save these across devices" (dropped "and get email alerts")
- **Changed (§1.5):** Resend scope narrowed to magic-link sends only
- **Added (§1.6):** Transfer code flow (generate on device A, redeem on device B, both adopt same anonId)

#### §2 (was Alerts, now Transfer code)
- **Removed:** Entire alerts section (cadence, worker, email template, unsubscribe)
- **Added:** Cross-device transfer section (why, flow, data model, rate limits)

#### §3 Per-job state
- **Changed (§3.1):** "second-strongest retention signal after alerts" → "one of the strongest retention signals on offer"

#### §4 Quality
- **Changed (§4.1):** `ADMIN_EMAILS` env list → single `ADMIN_EMAIL` env var

#### §6 Schema migrations
- **Changed:** Migration 2: `add_alert_fields` → `add_transfer_code`

#### §7 Build order
- **Changed:** Step 5: 6h → 5h (Resend is magic-link only)
- **Changed:** Step 6: "Saved-search alerting" 6h → "Cross-device transfer code" 2h
- **Changed:** Total: 32h → 27h

#### §8 Verification
- **Changed:** Test 2: "Alert delivery" → "Cross-device transfer"

#### §9 MVP3
- **Added:** Email alerts at top of deferred list with rationale

### mvp2_implementation_plan.md

#### §0 Prerequisites
- **Changed (§0.1):** `ADMIN_EMAILS` → `ADMIN_EMAIL`, `RESEND_FROM` repurposed, dropped "phase 6" cron note

#### Phase 4 (Feedback)
- **Changed (§4.2):** Admin gate code uses single email comparison

#### Phase 5 (Auth)
- **Changed:** Time estimate 6h → 5h (no alert-template work)

#### Phase 6 (was Alerts, now Transfer code)
- **Removed:** Entire alerts phase (schema, cadence UI, cron handler, email logic, unsubscribe)
- **Added:** Transfer code phase (schema, code generator, two routes, UI, cleanup, tests, verify)

#### §9 Migration sequencing
- **Changed:** Migration 4: `add_alert_fields` → `add_transfer_code`

#### §10 Rollout checklist
- **Changed:** `ADMIN_EMAILS` → `ADMIN_EMAIL` in flag-flip step

#### §11 Rollback playbook
- **Changed:** "Alert cron sends same email twice" → "Transfer code redeems on two devices simultaneously"
- **Changed:** "Resend bounces all email" → "Resend bounces magic-link emails" (dropped "alerts not delivered")

#### §12 Open questions
- **Changed:** Q1 marked ✅ decided (30-day expiry)
- **Changed:** Q2 marked ✅ decided (transfer code)
- **Changed:** Q3 struck through ✂️ cut (alerts deferred)
- **Changed:** Q4 marked ✅ decided (single `ADMIN_EMAIL`)
- **Changed:** Q5 struck through ✂️ cut (no alert branding)
- **Changed:** Intro reworded: "All resolved" record, not "to resolve before phase 5"

#### §13 Total estimate
- **Changed:** Phase 5: 6h → 5h, Phase 6: "Alerts" 6h 1.5× → "Transfer code" 2h 1.1×
- **Changed:** Raw total: 32h → 27h, risk-adjusted: ~42h → ~33h, working days: ~10 → ~8
- **Changed:** Closing note: "Cutting alerts saved roughly 9h of risk-adjusted scope"

#### §14 Decisions (new)
- **Added:** Entire section with 8 technical decisions (14.0–14.7)

---

## Env var changes

| Var | Before | After | Reason |
|---|---|---|---|
| `RESEND_FROM` | `alerts@openrolekb.app` | `hello@openrolekb.app` | Repurposed for magic-link only |
| `ADMIN_EMAILS` | comma-separated list | `ADMIN_EMAIL` (single) | One admin for MVP2 |
| `# Cron` comment | `(phase 2, 6)` | `(phase 2)` | Phase 6 no longer has a cron |

---

## Risk assessment

### Reduced risks
- Email deliverability (DKIM/SPF, spam filters, unsubscribe compliance) — gone
- Cron idempotency bugs (duplicate alerts) — gone
- Alert-diff logic bugs (stale `lastSeenUrls`) — gone
- Resend quota management — simplified (magic-link only, predictable volume)

### New risks
- Transfer-code collision (mitigated: 729M keyspace, 10-min TTL, 5-attempt retry)
- Transfer-code brute-force (mitigated: 5/min IP limit, 6-char = 729M guesses)
- Auth.js + Prisma 7 incompatibility (mitigated: §14.0 smoke test in Phase 1)

### Unchanged risks
- Auth integration complexity (still 1.5× multiplier)
- Anon→user merge correctness (now includes SavedSearch dedupe via §14.2)

---

## Things to watch during implementation

1. **Phase 1 smoke test (§14.0):** If Auth.js adapter fails against Prisma 7, the +2h contingency kicks in. Don't skip this test.

2. **SavedSearch.queryHash backfill (§14.2):** Existing rows need `queryHash` computed before the unique constraint lands. Run as a data migration, not a schema-only migration.

3. **Partial unique index (§14.2):** Prisma doesn't generate partial indexes from the schema DSL. The migration needs raw SQL:
   ```sql
   CREATE UNIQUE INDEX saved_search_anon_unique 
   ON "SavedSearch"("anonId", "queryHash") 
   WHERE "anonId" IS NOT NULL;
   ```

4. **Transfer-code cleanup (Phase 6 §6.5):** Expired codes are purged by the existing cache-purge cron. Verify the cron runs daily and the `deleteMany` is added.

5. **Rate-limit split (§14.5):** Phase 6 routes call named exports (`rateLimitTransferGen`, `rateLimitTransferRedeem`), not the generic `rateLimit(req, ownerKey?)`. Grep for `rateLimit(` in Phase 6 code to catch mistakes.

6. **Sentry PII (§14.6):** The `beforeSend` hook is a backstop. Primary defense: don't pass `email` or `rawQuery` to `captureRouteError` tags in the first place. Add a PR-template checklist item.

7. **Hidden-company casing (§14.3):** Phase 7 adds 6 new ATS hosts. Each needs a casing-edge-case fixture (e.g., Workday's `acmeRobotics` slug). Don't skip this — a missed case silently breaks the hide filter.

---

## Concerns / things that could go wrong

**None blocking.** The plan is conservative and well-scoped. Three minor watch-outs:

1. **Auth.js adapter incompatibility** — the §14.0 smoke test catches this early. If it fails, vendoring a custom adapter is straightforward (14 methods, most one-liners). Budget the +2h.

2. **SavedSearch dedupe migration** — the `queryHash` backfill + partial unique index is the trickiest migration in MVP2. Test against a prod-data snapshot before running in prod. The rollback is `DROP INDEX` + `ALTER TABLE DROP COLUMN`, but you lose the dedupe benefit.

3. **Transfer-code UX on slow networks** — the 10-minute TTL is generous, but if a user generates a code on flaky WiFi and the request times out, they don't see the code and can't retry (rate-limited). The UI should show a "Generating…" spinner and a "Retry" button on timeout. Phase 6 §6.4 doesn't specify this — add it.

---

## Summary

The changes are **well-justified and scope-reducing**. Cutting alerts removes the single highest-risk feature (cron + email + unsubscribe compliance) and replaces it with a simpler, lower-risk alternative (transfer codes) that still solves the cross-device problem. The 8 small decisions in §14 are all sound and prevent future gotchas.

**Net impact:**
- Scope: -9h risk-adjusted (32h → 27h raw, 42h → 33h risk-adjusted)
- Risk: reduced (email deliverability, cron bugs, Resend quota gone)
- Features: 7 instead of 8, but cross-device still solved
- Time to ship: ~10 days → ~8 days

**Recommendation:** Proceed as planned. Start Phase 1 with the Auth.js + Prisma 7 smoke test. If that passes, the rest of the plan is low-risk and well-sequenced.

---

## P0 & P1 Fixes — Implementation Gaps

This section documents the critical gaps found in the current implementation (as of 2026-05-30) and provides step-by-step fixes.

**Context:** The codebase is ~80% complete. Core features work, but several gaps remain before production-ready. See `mvp2_audit.md` for the full audit.

---

## P0 Fixes (Blocking Production)

### P0.1: Run Missing Migrations

**Problem:** 4 migrations exist in schema but have no migration files. This causes schema drift between dev and prod.

**Missing migrations:**
- `add_user_auth` (User, Account, Session, VerificationToken, SavedSearch.userId)
- `add_transfer_code` (TransferCode)
- `add_job_location_remote` (Job.isRemote)
- `add_event_log` (EventLog)

**Why it matters:** Deploying to prod without migrations will fail because the DB schema won't match the Prisma client.

**Fix:**

```bash
# Generate migrations for all schema changes
npx prisma migrate dev --name add_user_auth
npx prisma migrate dev --name add_transfer_code
npx prisma migrate dev --name add_job_location_remote
npx prisma migrate dev --name add_event_log

# Verify all migrations are present
ls prisma/migrations/
```

**Expected output:** 6 migration directories total (2 existing + 4 new).

**Verification:**
```bash
npx prisma migrate status
# Should show: "Database schema is up to date!"
```

---

### P0.2: Fix SavedSearch.queryHash (Dedupe Broken)

**Problem:** `SavedSearch.queryHash` is nullable and never populated. The unique constraint `@@unique([userId, queryHash])` can't enforce dedupe if `queryHash` is null.

**Impact:** Users can save the same search multiple times. The saved-searches strip shows duplicates.

**Fix (3 steps):**

#### Step 1: Make queryHash required in schema

**File:** `prisma/schema.prisma`

```prisma
model SavedSearch {
  id        String   @id @default(cuid())
  anonId    String?
  userId    String?
  queryHash String   // ← Remove the ?
  rawQuery  String
  filters   Json
  createdAt DateTime @default(now())
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([anonId])
  @@index([userId])
  @@unique([userId, queryHash])
}
```

#### Step 2: Backfill existing rows

**File:** `prisma/migrations/YYYYMMDDHHMMSS_backfill_query_hash/migration.sql` (create manually)

```sql
-- Backfill queryHash for existing rows
UPDATE "SavedSearch"
SET "queryHash" = encode(digest(
  LOWER(TRIM("rawQuery")) || '::' || "filters"::text, 
  'sha256'
), 'hex')
WHERE "queryHash" IS NULL;

-- Make column required
ALTER TABLE "SavedSearch" ALTER COLUMN "queryHash" SET NOT NULL;
```

Run:
```bash
npx prisma migrate resolve --applied backfill_query_hash
npx prisma migrate deploy
```

#### Step 3: Populate queryHash on save

**File:** `src/app/api/saved/route.ts`

Add import:
```ts
import { hashQuery } from "@/lib/hash";
```

In the POST handler, before `prisma.savedSearch.create`:

```ts
const queryHash = hashQuery(rawQuery, filters);

await prisma.savedSearch.create({
  data: {
    userId: ownerKey, // or anonId if anon
    anonId: session ? null : ownerKey,
    rawQuery,
    filters,
    queryHash, // ← Add this
  },
});
```

**Verification:**
```bash
# Save the same search twice as the same user
# Second save should fail with unique constraint error
curl -X POST http://localhost:3000/api/saved \
  -H "Content-Type: application/json" \
  -H "x-anon-id: test-uuid" \
  -d '{"rawQuery":"react remote","filters":{}}'

# Run again — should return 409 or silently skip
```

---

### P0.3: Add Anon Expiry to Cache-Purge Cron

**Problem:** Anon data (SavedSearch, JobInteraction, HiddenCompany) grows unbounded. Per Q1 decision, anon rows should expire after 30 days of inactivity.

**Impact:** DB grows indefinitely with abandoned anon state.

**Fix:**

**File:** `src/app/api/cron/cache-purge/route.ts`

Add after the existing `SearchCache` purge:

```ts
// Purge anon data older than 30 days (Q1 decision)
const anonCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

// Get all user IDs to exclude from purge
const userIds = await prisma.user.findMany({ select: { id: true } });
const userIdSet = new Set(userIds.map((u) => u.id));

// Purge anon SavedSearch rows
const { count: savedCount } = await prisma.savedSearch.deleteMany({
  where: {
    anonId: { not: null },
    createdAt: { lt: anonCutoff },
  },
});

// Purge anon JobInteraction rows (ownerKey not in user IDs)
const { count: interactionCount } = await prisma.jobInteraction.deleteMany({
  where: {
    ownerKey: { notIn: Array.from(userIdSet) },
    createdAt: { lt: anonCutoff },
  },
});

// Purge anon HiddenCompany rows
const { count: hiddenCount } = await prisma.hiddenCompany.deleteMany({
  where: {
    ownerKey: { notIn: Array.from(userIdSet) },
    createdAt: { lt: anonCutoff },
  },
});

console.log(`Purged anon data: ${savedCount} searches, ${interactionCount} interactions, ${hiddenCount} hidden companies`);
```

**Verification:**
```bash
# Manually trigger the cron
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/cache-purge

# Check logs for purge counts
# Insert a 31-day-old anon row and verify it gets purged
```

---

## P1 Fixes (Missing Features)

### P1.1: Transfer Code UI

**Problem:** Backend works (`/api/transfer-code` and `/api/transfer-code/redeem`), but there's no UI. Users can't generate or redeem codes.

**What's needed:**
- Generate modal (show 6-char code + copy button + countdown)
- Redeem modal (6-char input, auto-uppercase)
- UI triggers in `UserMenu.tsx` (anon only)

**Fix (3 files):**

#### File 1: `src/components/TransferCodeModal.tsx` (new)

```tsx
"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

type Mode = "generate" | "redeem" | null;

interface Props {
  mode: Mode;
  onClose: () => void;
}

export function TransferCodeModal({ mode, onClose }: Props) {
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode === "generate") handleGenerate();
  }, [mode]);

  async function handleGenerate() {
    setLoading(true);
    setError("");
    try {
      const anonId = localStorage.getItem("openrolekb_anon_id");
      const res = await fetch("/api/transfer-code", {
        method: "POST",
        headers: { "x-anon-id": anonId || "" },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCode(data.code);
      setExpiresAt(new Date(data.expiresAt));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate code");
    } finally {
      setLoading(false);
    }
  }

  async function handleRedeem() {
    if (input.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/transfer-code/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input.toUpperCase() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      localStorage.setItem("openrolekb_anon_id", data.anonId);
      window.dispatchEvent(new CustomEvent("openrolekb:saved-changed"));
      onClose();
      window.location.reload(); // Refresh to show synced state
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  }

  if (!mode) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl max-w-md w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-ink-soft hover:text-ink"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {mode === "generate" && (
          <>
            <h2 className="text-h2 font-display mb-4">Transfer to another device</h2>
            {loading && <p className="text-small text-ink-soft">Generating code...</p>}
            {error && <p className="text-small text-danger">{error}</p>}
            {code && (
              <>
                <p className="text-small text-ink-soft mb-4">
                  Enter this code on your other device within 10 minutes:
                </p>
                <div className="bg-surface-2 rounded-lg p-4 text-center mb-4">
                  <p className="text-[2rem] font-mono font-bold tracking-widest text-ink">
                    {code}
                  </p>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(code)}
                  className="w-full px-4 py-2 rounded-full bg-accent text-white hover:opacity-90"
                >
                  Copy code
                </button>
                {expiresAt && (
                  <p className="text-micro text-ink-soft mt-2 text-center">
                    Expires in {Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000))} minutes
                  </p>
                )}
              </>
            )}
          </>
        )}

        {mode === "redeem" && (
          <>
            <h2 className="text-h2 font-display mb-4">Enter transfer code</h2>
            <p className="text-small text-ink-soft mb-4">
              Enter the 6-character code from your other device:
            </p>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              className="w-full px-4 py-3 rounded-lg border border-border bg-surface text-center text-[1.5rem] font-mono tracking-widest uppercase mb-4"
              maxLength={6}
              autoFocus
            />
            {error && <p className="text-small text-danger mb-4">{error}</p>}
            <button
              onClick={handleRedeem}
              disabled={input.length !== 6 || loading}
              className="w-full px-4 py-2 rounded-full bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Redeeming..." : "Transfer"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

#### File 2: Update `src/components/UserMenu.tsx`

Add transfer code links for anon users:

```tsx
import { TransferCodeModal } from "./TransferCodeModal";

export function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<"generate" | "redeem" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ... existing code ...

  // For anon users, show transfer options
  if (!session?.user) {
    return (
      <>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="text-small text-ink-soft hover:text-ink"
          >
            Menu
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-surface shadow-lg py-1 z-50">
              <button
                onClick={() => { setTransferMode("generate"); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-small text-ink hover:bg-surface-2"
              >
                Transfer to another device
              </button>
              <button
                onClick={() => { setTransferMode("redeem"); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-small text-ink hover:bg-surface-2"
              >
                Have a transfer code?
              </button>
            </div>
          )}
        </div>
        <TransferCodeModal mode={transferMode} onClose={() => setTransferMode(null)} />
      </>
    );
  }

  // Existing signed-in user menu...
}
```

**Verification:**
1. As anon user, save a search
2. Click "Transfer to another device" → see 6-char code
3. Open incognito window, click "Have a transfer code?", enter code
4. Verify saved search appears in incognito window

---

### P1.2: Admin Pages UI

**Problem:** `/api/admin/feedback` and `/api/admin/health` routes exist, but no UI pages. Admin can't view feedback or metrics.

**Fix (2 files):**

#### File 1: `src/app/admin/feedback/page.tsx` (new)

```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function AdminFeedbackPage() {
  const session = await auth();
  const allowed = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  
  if (!session?.user?.email || session.user.email.toLowerCase() !== allowed) {
    redirect("/");
  }

  const events = await prisma.feedbackEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-h1 font-display mb-6">Feedback Events</h1>
      <p className="text-small text-ink-soft mb-4">Last 100 events</p>
      
      <div className="overflow-x-auto">
        <table className="w-full border border-border">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-3 py-2 text-left text-small">Date</th>
              <th className="px-3 py-2 text-left text-small">Kind</th>
              <th className="px-3 py-2 text-left text-small">Query</th>
              <th className="px-3 py-2 text-left text-small">Score</th>
              <th className="px-3 py-2 text-left text-small">Comment</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-3 py-2 text-micro">{new Date(e.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 text-small">{e.kind}</td>
                <td className="px-3 py-2 text-small truncate max-w-xs">{e.rawQuery}</td>
                <td className="px-3 py-2 text-small">{e.rerankScore?.toFixed(2) || "—"}</td>
                <td className="px-3 py-2 text-small truncate max-w-xs">{e.comment || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

#### File 2: `src/app/admin/health/page.tsx` (new)

```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function AdminHealthPage() {
  const session = await auth();
  const allowed = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  
  if (!session?.user?.email || session.user.email.toLowerCase() !== allowed) {
    redirect("/");
  }

  const events = await prisma.eventLog.findMany({
    where: { evt: "search" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const stats = {
    total: events.length,
    cacheHits: events.filter((e) => e.cacheHit).length,
    avgTotal: Math.round(events.reduce((sum, e) => sum + e.totalMs, 0) / events.length),
    avgParse: Math.round(events.reduce((sum, e) => sum + e.parseMs, 0) / events.length),
    avgExa: Math.round(events.reduce((sum, e) => sum + e.exaMs, 0) / events.length),
    avgRerank: Math.round(events.reduce((sum, e) => sum + e.rerankMs, 0) / events.length),
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-h1 font-display mb-6">Health Dashboard</h1>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-2 rounded-lg p-4">
          <p className="text-micro text-ink-soft">Total Searches</p>
          <p className="text-h2 font-display">{stats.total}</p>
        </div>
        <div className="bg-surface-2 rounded-lg p-4">
          <p className="text-micro text-ink-soft">Cache Hit Rate</p>
          <p className="text-h2 font-display">{((stats.cacheHits / stats.total) * 100).toFixed(0)}%</p>
        </div>
        <div className="bg-surface-2 rounded-lg p-4">
          <p className="text-micro text-ink-soft">Avg Total (ms)</p>
          <p className="text-h2 font-display">{stats.avgTotal}</p>
        </div>
        <div className="bg-surface-2 rounded-lg p-4">
          <p className="text-micro text-ink-soft">Avg Rerank (ms)</p>
          <p className="text-h2 font-display">{stats.avgRerank}</p>
        </div>
      </div>

      <h2 className="text-h2 mb-4">Recent Searches (last 100)</h2>
      <div className="overflow-x-auto">
        <table className="w-full border border-border text-small">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Cache</th>
              <th className="px-3 py-2 text-right">Parse</th>
              <th className="px-3 py-2 text-right">Exa</th>
              <th className="px-3 py-2 text-right">Rerank</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Results</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-3 py-2">{new Date(e.createdAt).toLocaleTimeString()}</td>
                <td className="px-3 py-2">{e.cacheHit ? "✅" : "—"}</td>
                <td className="px-3 py-2 text-right">{e.parseMs}</td>
                <td className="px-3 py-2 text-right">{e.exaMs}</td>
                <td className="px-3 py-2 text-right">{e.rerankMs}</td>
                <td className="px-3 py-2 text-right font-medium">{e.totalMs}</td>
                <td className="px-3 py-2 text-right">{e.resultCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

**Verification:**
1. Sign in as admin (email matches `ADMIN_EMAIL` env var)
2. Visit `/admin/feedback` → see feedback events table
3. Visit `/admin/health` → see search metrics dashboard

---

### P1.3: EventLog Population

**Problem:** `EventLog` table exists but `/api/search` doesn't write to it. `/admin/health` shows empty data.

**Fix:**

**File:** `src/app/api/search/route.ts`

Add timing variables at the start of the `start()` function:

```ts
async start(controller) {
  const t0 = performance.now();
  let tParse = t0, tExa = t0, tRerank = t0;
  
  // ... existing code ...
  
  const { filters } = await parseQuery(rawQuery);
  tParse = performance.now();
  send("parsed", filters);
  
  // ... cache check ...
  
  const exaResults = await searchJobs(rawQuery, filters);
  tExa = performance.now();
  send("results", exaResults);
  
  // ... rerank ...
  reranked = await rerank(rawQuery, exaResults);
  tRerank = performance.now();
  send("rerank", reranked);
  
  // ... cache write ...
  
  send("done", { id: cacheId });
  
  // Write EventLog (add this block)
  try {
    await prisma.eventLog.create({
      data: {
        evt: "search",
        ownerKey: ownerKey ?? null,
        cacheHit: !!cached,
        resultCount: reranked.length,
        parseMs: Math.round(tParse - t0),
        exaMs: Math.round(tExa - tParse),
        rerankMs: Math.round(tRerank - tExa),
        totalMs: Math.round(performance.now() - t0),
      },
    });
  } catch (err) {
    // EventLog write failure is non-fatal
    console.error("Failed to write EventLog:", err);
  }
}
```

**Verification:**
```bash
# Run a search
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"react remote"}'

# Check EventLog table
psql $DATABASE_URL -c "SELECT evt, totalMs, resultCount FROM \"EventLog\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

---

### P1.4: Transfer Code Cleanup in Cron

**Problem:** Expired `TransferCode` rows are never deleted. Table grows unbounded.

**Fix:**

**File:** `src/app/api/cron/cache-purge/route.ts`

Add after the anon expiry block:

```ts
// Purge expired transfer codes (Phase 6 §6.5)
const { count: transferCount } = await prisma.transferCode.deleteMany({
  where: { expiresAt: { lt: new Date() } },
});

console.log(`Purged ${transferCount} expired transfer codes`);
```

**Verification:**
```bash
# Insert an expired code manually
psql $DATABASE_URL -c "INSERT INTO \"TransferCode\" (code, \"anonId\", \"expiresAt\", \"createdAt\") VALUES ('TEST01', 'test-uuid', NOW() - INTERVAL '1 hour', NOW());"

# Run cron
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/cache-purge

# Verify code was deleted
psql $DATABASE_URL -c "SELECT * FROM \"TransferCode\" WHERE code = 'TEST01';"
# Should return 0 rows
```

---

## Implementation Prompt

Use this prompt to implement all P0 and P1 fixes in one session:

```
Implement all P0 and P1 fixes from mvp2_fixes.md:

P0 (blocking production):
1. Run missing migrations: add_user_auth, add_transfer_code, add_job_location_remote, add_event_log
2. Fix SavedSearch.queryHash: make required, backfill existing rows, populate on save
3. Add anon expiry to cache-purge cron (30-day purge)

P1 (missing features):
4. Build transfer code UI: TransferCodeModal.tsx + update UserMenu.tsx
5. Build admin pages: /admin/feedback/page.tsx + /admin/health/page.tsx
6. Add EventLog population in /api/search route.ts
7. Add transfer code cleanup to cache-purge cron

Follow the exact code snippets in mvp2_fixes.md sections P0.1 through P1.4.

After each fix, verify using the verification steps provided.

When done, run:
- npm test (should still pass)
- npm run build (should succeed)
- Manual test: anon save → transfer code → redeem on new device → verify sync
```

---

## Verification Checklist

After implementing all fixes, verify:

- [ ] `npx prisma migrate status` shows all migrations applied
- [ ] Saving same search twice as same user fails with unique constraint
- [ ] Cache-purge cron purges 31-day-old anon data
- [ ] Transfer code UI works (generate → redeem → sync)
- [ ] Admin pages load and show data (sign in as ADMIN_EMAIL first)
- [ ] `/admin/health` shows search metrics after running searches
- [ ] Expired transfer codes are purged by cron
- [ ] All tests still pass (`npm test`)
- [ ] Build succeeds (`npm run build`)

