# OpenRoleKB — MVP2 Implementation Plan

This is the build playbook for `mvp2.md`. Each phase is independently shippable. Don't move to phase N+1 until phase N's verification block passes locally and in a Vercel preview.

> ⚠️ **Read this before coding any phase.** Per `AGENTS.md`, this codebase is on Next.js 16 — APIs may differ from training data. Before each phase, skim the relevant guide in `node_modules/next/dist/docs/` (especially routing, route handlers, server actions, and middleware). Do not assume Next 14/15 patterns transfer.

---

## 0. Prerequisites

### 0.1 New env vars

Append to `.env.example`:

```
# Auth (phase 5)
AUTH_SECRET=                # `openssl rand -base64 32`
AUTH_URL=http://localhost:3000
RESEND_API_KEY=
RESEND_FROM=hello@openrolekb.app   # used only by Auth.js magic-link sends

# Cron (phase 2)
CRON_SECRET=                # `openssl rand -hex 32`

# Rate limit (phase 2)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Observability (phase 8)
SENTRY_DSN=
SENTRY_AUTH_TOKEN=          # for source map upload at build time
ADMIN_EMAIL=                # single admin email, e.g. you@example.com
```

Mirror these in `.env` for local dev. Local dev for cron uses `curl` with `x-cron-secret`. Local Resend uses the test key (emails go to the dashboard, not real inboxes).

### 0.2 New dependencies

Add in **one** install at the start of each phase that needs them — do not pre-install. Tracking here so reviewers can audit:

| Phase | Package | Purpose |
|---|---|---|
| 1 | `vitest`, `@vitest/coverage-v8` (dev) | Test runner |
| 2 | `@upstash/redis`, `@upstash/ratelimit` | Distributed rate limit |
| 5 | `next-auth@beta`, `@auth/prisma-adapter`, `resend` | Auth + email |
| 8 | `@sentry/nextjs` | Error tracking |

### 0.3 Working agreement

- Each phase is a separate PR. Don't bundle unrelated migrations.
- Migrations: `npx prisma migrate dev --name <descriptive_snake_case>`. Never `db push` past phase 1.
- Each PR includes: schema migration (if any), code, tests, and a one-line entry in `CHANGELOG.md` (create the file in phase 1).
- Feature flags: gate every new surface with `process.env.MVP2_<FEATURE>=on` until verified in production for ≥48h. Then drop the flag in a follow-up PR.

---

## Phase 1 — Test scaffold (~2h)

### 1.1 Files to create

```
vitest.config.ts
src/lib/__tests__/company.test.ts
src/lib/__tests__/hash.test.ts
src/lib/__tests__/rate-limit.test.ts
src/app/api/search/__tests__/route.test.ts
src/app/api/saved/__tests__/route.test.ts
test/fixtures/exa-results.json
test/fixtures/rerank-response.json
test/setup.ts
CHANGELOG.md
```

### 1.2 `vitest.config.ts` skeleton

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: { include: ["src/lib/**", "src/app/api/**"], reporter: ["text", "html"] },
  },
});
```

`test/setup.ts` loads `.env.test` (create with safe placeholder secrets — never real keys) via `dotenv/config`.

### 1.3 `package.json` additions

```jsonc
"scripts": {
  // ... existing
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

### 1.4 Test cases (specific, not aspirational)

**`company.test.ts`** — one fixture per ATS:
- `boards.greenhouse.io/acmerobotics/jobs/12345` → `acmerobotics`
- `jobs.lever.co/superhuman/abc-def` → `superhuman`
- `jobs.ashbyhq.com/notion/some-id` → `notion`
- `apply.workable.com/automattic/j/ABC123/` → `automattic`
- `linkedin.com/jobs/view/9999` → `null`
- malformed URL → `null` (no throw)

**`hash.test.ts`**:
- Same query with different whitespace/case → identical hash.
- Filters with keys in different order → identical hash (use a stable serializer).
- Different query → different hash.

**`rate-limit.test.ts`** — covers FIXES.md #9:
- Inject a clock; consume 10 tokens; advance time by 30s; assert no refill.
- Advance to 60s; assert refill of exactly `MAX_REQUESTS`, `lastRefill` advanced by `WINDOW_MS` (not `now`).
- Advance to 150s; assert refill capped at `MAX_REQUESTS` (no overflow), `lastRefill += 2*WINDOW_MS`.

**`search/route.test.ts`** — mock `searchJobs`, `parseQuery`, `rerank`, `cacheSearch`, `getCachedSearch`. Call the route handler directly with a synthetic `Request`. Read the SSE stream; assert event order: `parsed → results → rerank → done`, and that `done.data.id` is the cacheId returned by the mock.

**`saved/route.test.ts`** — POST with `x-anon-id`, GET, DELETE. Use a Prisma test database (separate `DATABASE_URL` in `.env.test`) or mock Prisma at the module boundary.

### 1.5 Verify
```bash
npm test                 # all green
npm run test:coverage    # lib/* ≥ 80% line coverage
```

CI: add a `.github/workflows/test.yml` (if not present) running `npm ci && npm test` on PRs.

---

## Phase 2 — Cache purge cron + Upstash rate limit (~2h)

### 2.1 Cache purge

**File:** `src/app/api/cron/cache-purge/route.ts` (new)

```ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { count } = await prisma.searchCache.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  // Orphan job sweep — small batches to keep the cron fast
  // (deferred until JobInteraction lands in phase 3 — leave a TODO here)
  return Response.json({ purgedCaches: count });
}
```

**File:** `vercel.json` (new)
```json
{
  "crons": [
    { "path": "/api/cron/cache-purge", "schedule": "5 2 * * *" }
  ]
}
```

Vercel Cron invokes the route via GET; add `x-cron-secret` via the project settings → Cron → Headers.

### 2.2 Upstash rate limit

**File:** `src/lib/rate-limit.ts` — replace the in-memory implementation:

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";

const redis = Redis.fromEnv();

const ipLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  prefix: "rl:ip",
});

const ownerLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(100, "24 h"),
  prefix: "rl:owner",
});

export async function rateLimit(req: NextRequest, ownerKey?: string): Promise<{ ok: boolean; reason?: string }> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipResult = await ipLimiter.limit(ip);
  if (!ipResult.success) return { ok: false, reason: "ip" };

  if (ownerKey) {
    const ownerResult = await ownerLimiter.limit(ownerKey);
    if (!ownerResult.success) return { ok: false, reason: "owner" };
  }

  return { ok: true };
}
```

`route.ts` becomes `await`-aware:
```ts
const { ok, reason } = await rateLimit(request, ownerKey);
if (!ok) return new Response(JSON.stringify({ error: `Rate limit (${reason})` }), { status: 429, ... });
```

**Migration note:** the function signature changed from sync to async. Both call sites (`/api/search`, `/api/saved`) need updating. Search the repo for `rateLimit(` to make sure none are missed.

### 2.3 Verify

```bash
# cache purge
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/cache-purge
# expect: {"purgedCaches": 0} on a fresh DB; populate a >7d row to test deletion

# rate limit
for i in {1..12}; do curl -i -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' -d '{"query":"x"}' | head -1; done
# expect: 11th and 12th return 429
```

Add `lib/rate-limit.test.ts` updates: the new tests mock `@upstash/redis` (Upstash docs include a mock helper).

EOF

---

## Phase 3 — Per-job interactions: data + API + UI (~6h)

### 3.1 Schema migration

**File:** `prisma/schema.prisma` — append:

```prisma
model JobInteraction {
  id        String   @id @default(cuid())
  ownerKey  String
  jobId     String
  kind      String   // "saved" | "hidden" | "applied" | "dismissed"
  note      String?
  createdAt DateTime @default(now())
  job       Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@unique([ownerKey, jobId, kind])
  @@index([ownerKey, kind])
}

model HiddenCompany {
  id        String   @id @default(cuid())
  ownerKey  String
  company   String
  createdAt DateTime @default(now())

  @@unique([ownerKey, company])
  @@index([ownerKey])
}
```

Add the back-relation to `Job`:
```prisma
model Job {
  // ... existing
  interactions JobInteraction[]
}
```

```bash
npx prisma migrate dev --name add_job_interactions
```

### 3.2 `ownerKey` resolver

**File:** `src/lib/owner.ts` (new) — single source of truth used by every protected route.

```ts
import type { NextRequest } from "next/server";

export function getOwnerKey(req: NextRequest): string | null {
  // In phase 5, prefer session.user.id over the header.
  // For phase 3, anon-only.
  const anonId = req.headers.get("x-anon-id");
  if (anonId && /^[0-9a-f-]{36}$/.test(anonId)) return anonId;
  return null;
}
```

When phase 5 lands, this function will return `session.user.id ?? anonId`. Every caller already routes through it, so the upgrade is one-file.

### 3.3 API routes

**File:** `src/app/api/interactions/route.ts` (new)

```ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerKey } from "@/lib/owner";

const KINDS = ["saved", "hidden", "applied", "dismissed"] as const;

export async function POST(req: NextRequest) {
  const ownerKey = getOwnerKey(req);
  if (!ownerKey) return new Response("anon-id required", { status: 401 });

  const { jobId, kind, note } = await req.json();
  if (!jobId || !KINDS.includes(kind)) {
    return new Response("invalid", { status: 400 });
  }

  const row = await prisma.jobInteraction.upsert({
    where: { ownerKey_jobId_kind: { ownerKey, jobId, kind } },
    create: { ownerKey, jobId, kind, note },
    update: { note },
  });
  return Response.json(row);
}

export async function DELETE(req: NextRequest) {
  const ownerKey = getOwnerKey(req);
  if (!ownerKey) return new Response("anon-id required", { status: 401 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const kind = url.searchParams.get("kind");
  if (!jobId || !kind) return new Response("invalid", { status: 400 });

  await prisma.jobInteraction.deleteMany({ where: { ownerKey, jobId, kind } });
  return new Response(null, { status: 204 });
}
```

**File:** `src/app/api/hidden-companies/route.ts` (new) — same shape, on `HiddenCompany`. Lowercase `company` on write.

**File:** `src/app/api/me/saved-jobs/route.ts` (new) — GET only.

```ts
const ownerKey = getOwnerKey(req);
if (!ownerKey) return Response.json([]);
const interactions = await prisma.jobInteraction.findMany({
  where: { ownerKey, kind: "saved" },
  include: { job: true },
  orderBy: { createdAt: "desc" },
  take: 100,
});
return Response.json(interactions);
```

### 3.4 Server-side hide filter on `/api/search`

**File:** `src/app/api/search/route.ts` — after the `rerank` block, before `cacheSearch`:

```ts
if (ownerKey) {
  const hidden = await prisma.hiddenCompany.findMany({
    where: { ownerKey },
    select: { company: true },
  });
  const hiddenSet = new Set(hidden.map((h) => h.company.toLowerCase()));
  if (hiddenSet.size) {
    const keepIdx = new Set<number>();
    exaResults.forEach((r, i) => {
      const company = extractCompany(r.url)?.toLowerCase();
      if (!company || !hiddenSet.has(company)) keepIdx.add(i);
    });
    reranked = reranked.filter((r) => keepIdx.has(r.idx));
  }
}
```

This runs **after** rerank so the rubric isn't biased and the filter is observable in logs.

### 3.5 UI wiring

**File:** `src/components/ResultRow.tsx` — add a small action row at bottom-right. Three icon buttons: `Star` (saved), `EyeOff` (hide-company), `Check` (applied). Each is a 24×24 ghost button. On click, optimistic-update local state and fire the corresponding API call.

```tsx
// Pseudocode — adapt to existing JSX
const [saved, setSaved] = useState(initial.saved);
async function toggleSaved() {
  const next = !saved;
  setSaved(next);
  const method = next ? "POST" : "DELETE";
  const url = next ? "/api/interactions" : `/api/interactions?jobId=${job.id}&kind=saved`;
  const body = next ? JSON.stringify({ jobId: job.id, kind: "saved" }) : undefined;
  await fetch(url, { method, headers: { "Content-Type": "application/json", "x-anon-id": getAnonId() }, body });
}
```

Initial state comes from a new `state.interactions` map on `page.tsx`, populated alongside `state.exaResults` once `done` arrives. Fetch from `/api/me/saved-jobs` on mount, plus a per-result lookup.

**File:** `src/components/DetailPane.tsx` — wire the existing `[ Save ⭐ ]` and `[ Hide this company ]` buttons. Both call the same APIs as ResultRow. Hide-company also dispatches a `openrolekb:results-changed` event so `ResultsList` can drop the row immediately.

**File:** `src/app/saved/page.tsx` (new) — server component.

```tsx
import { prisma } from "@/lib/prisma";
import { cookies, headers } from "next/headers";
import { ResultRow } from "@/components/ResultRow";

export default async function SavedPage() {
  // anon flow only in phase 3 — phase 5 adds session resolution
  const anonId = (await headers()).get("x-anon-id"); // set by middleware in phase 3.6
  if (!anonId) return <EmptyState />;
  const interactions = await prisma.jobInteraction.findMany({
    where: { ownerKey: anonId, kind: "saved" },
    include: { job: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-h1 font-display">Saved jobs</h1>
      {interactions.length === 0 ? <EmptyState /> : (
        <ul className="mt-6 space-y-3">
          {interactions.map(({ job }) => <SavedRow key={job.id} job={job} />)}
        </ul>
      )}
    </main>
  );
}
```

`SavedRow` reuses ResultRow visuals minus the score chip (no rerank in this context).

### 3.6 Header link

`src/app/layout.tsx` — add a `Saved` link to the header next to `ThemeToggle`. Show it only when the client has at least one saved interaction (read-from-localStorage cache populated by the result-row toggles, OR fetch on mount). Don't block the header on a network call.

### 3.7 Tests

- `interactions.test.ts`: POST/DELETE roundtrip, idempotent POST, missing anon-id → 401.
- `hidden-companies.test.ts`: same shape.
- `search/route.test.ts`: extend with a fixture where one Greenhouse result is from a hidden company; assert it's missing from the `rerank` event payload.

### 3.8 Verify

1. From the home page, save a job → reload → row shows the filled star.
2. Hide a company on a result with `extractCompany(url)` defined → re-run the same query → that row is gone.
3. Visit `/saved` → see the saved row; click the star to unsave → row disappears.
4. Hidden-company filter only fires post-rerank — server logs show `rerank.length=N` then `after-hide.length=M ≤ N`.


---

## Phase 4 — Feedback modal + admin view (~3h)

### 4.1 Schema migration

```prisma
model FeedbackEvent {
  id          String   @id @default(cuid())
  ownerKey    String
  jobId       String
  kind        String   // wrong_role | wrong_seniority | wrong_location | stale | other
  rawQuery    String
  filters     Json
  rerankScore Float?
  fit         String?
  comment     String?
  createdAt   DateTime @default(now())

  @@index([kind, createdAt])
  @@index([ownerKey, createdAt])
}
```

```bash
npx prisma migrate dev --name add_feedback_events
```

### 4.2 API

**File:** `src/app/api/feedback/route.ts` (new)

```ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerKey } from "@/lib/owner";

const KINDS = ["wrong_role", "wrong_seniority", "wrong_location", "stale", "other"] as const;

export async function POST(req: NextRequest) {
  const ownerKey = getOwnerKey(req) ?? "anonymous";
  const body = await req.json();
  if (!KINDS.includes(body.kind)) return new Response("invalid kind", { status: 400 });
  if (!body.jobId || !body.rawQuery) return new Response("missing fields", { status: 400 });

  const row = await prisma.feedbackEvent.create({
    data: {
      ownerKey,
      jobId: body.jobId,
      kind: body.kind,
      rawQuery: body.rawQuery,
      filters: body.filters ?? {},
      rerankScore: body.rerankScore ?? null,
      fit: body.fit ?? null,
      comment: body.comment?.slice(0, 500) ?? null,
    },
  });
  return Response.json({ id: row.id });
}
```

### 4.3 UI: 1-question modal

**File:** `src/components/FeedbackModal.tsx` (new) — controlled `<dialog>` element.

- Triggered by the `Tell us this match was off →` link in `DetailPane.tsx`.
- Radio group with the five `KINDS`, prelabeled in user-friendly copy ("Wrong role", "Wrong seniority", "Wrong location", "Already filled / stale", "Something else").
- Optional `<textarea>` for `comment`, 500-char counter.
- Submit posts to `/api/feedback` with `{ jobId, rawQuery, filters, rerankScore, fit, kind, comment }`. Closes on success with a "Thanks, that helps." inline confirmation.
- Respects `prefers-reduced-motion` per `globals.css`.

### 4.4 Admin page

**File:** `src/app/admin/feedback/page.tsx` (new) — server component.

```tsx
import { auth } from "@/lib/auth"; // phase 5 — until then, stub with email-from-cookie
import { prisma } from "@/lib/prisma";

export default async function AdminFeedback() {
  const session = await auth();
  const allowed = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!session?.user?.email || session.user.email.toLowerCase() !== allowed) {
    return <p className="p-8">Forbidden.</p>;
  }
  const events = await prisma.feedbackEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { /* derive job via raw query if useful */ },
  });
  return <FeedbackTable events={events} />;
}
```

**Phase-3-only stub:** until phase 5 lands, gate by a `?admin=<CRON_SECRET>` query param so you can review feedback before auth ships. Replace with the session check the moment phase 5 is merged.

### 4.5 Tests

`feedback.test.ts`: POST with each kind, invalid kind → 400, comment over 500 chars → truncated.

### 4.6 Verify

1. Open a result, click the feedback link, pick a reason, submit. See the inline thanks.
2. `psql $DATABASE_URL -c "SELECT kind, count(*) FROM \"FeedbackEvent\" GROUP BY kind;"` — counts match what you submitted.
3. `/admin/feedback?admin=$CRON_SECRET` lists events.

---

## Phase 5 — Auth.js + Resend + sign-in modal (~6h)

This is the highest-risk phase. Budget 1.5x. Read `node_modules/next/dist/docs/` first — the App Router auth integration changed shape in Next 16.

### 5.1 Schema migration

```prisma
model User {
  id            String     @id @default(cuid())
  email         String     @unique
  name          String?
  image         String?
  emailVerified DateTime?
  anonId        String?    @unique
  createdAt     DateTime   @default(now())
  accounts      Account[]
  sessions      Session[]
  savedSearches SavedSearch[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  @@unique([identifier, token])
}

model SavedSearch {
  id        String   @id @default(cuid())
  userId    String?
  anonId    String?
  // ... existing rawQuery, filters, etc.
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([anonId])
}
```

```bash
npx prisma migrate dev --name add_user_auth
```

### 5.2 Auth.js config

**File:** `src/lib/auth.ts` (new)

```ts
import NextAuth from "next-auth";
import EmailProvider from "next-auth/providers/email";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

const resend = new Resend(process.env.RESEND_API_KEY);

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    EmailProvider({
      from: process.env.RESEND_FROM,
      sendVerificationRequest: async ({ identifier, url }) => {
        await resend.emails.send({
          from: process.env.RESEND_FROM!,
          to: identifier,
          subject: "Sign in to OpenRoleKB",
          html: signInEmailHtml(url),
          text: `Sign in: ${url}`,
        });
      },
    }),
  ],
  session: { strategy: "database" },
  events: {
    signIn: async ({ user }) => {
      // Anon → user merge runs here. See §5.4
    },
  },
});

function signInEmailHtml(url: string) {
  return `<!doctype html><html><body style="font-family:system-ui">
    <p>Click to sign in to OpenRoleKB:</p>
    <p><a href="${url}" style="background:#E07A3A;color:#fff;padding:10px 16px;border-radius:9999px;text-decoration:none">Sign in</a></p>
    <p>If you didn't request this, ignore this email.</p></body></html>`;
}
```

**File:** `src/app/api/auth/[...nextauth]/route.ts` (new)

```ts
export { GET, POST } from "@/lib/auth";
```

### 5.3 Update `getOwnerKey`

**File:** `src/lib/owner.ts` — extend with session resolution.

```ts
import { auth } from "@/lib/auth";

export async function getOwnerKey(req: NextRequest): Promise<string | null> {
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  const anonId = req.headers.get("x-anon-id");
  if (anonId && /^[0-9a-f-]{36}$/.test(anonId)) return anonId;
  return null;
}
```

This is now async — every caller (`/api/search`, `/api/saved`, `/api/interactions`, `/api/hidden-companies`, `/api/feedback`, `/api/me/saved-jobs`) needs `await`. Grep for `getOwnerKey(` and update all sites.

### 5.4 Anon → user merge

In `events.signIn`:

```ts
events: {
  signIn: async ({ user }) => {
    // Read x-anon-id from cookies if it leaked through; otherwise the client posts it explicitly.
    // We accept the merge via a separate POST /api/auth/merge endpoint instead — cleaner.
  },
},
```

**File:** `src/app/api/auth/merge/route.ts` (new)

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("unauthorized", { status: 401 });
  const { anonId } = await req.json();
  if (!/^[0-9a-f-]{36}$/.test(anonId)) return new Response("invalid", { status: 400 });

  await prisma.$transaction([
    prisma.user.update({ where: { id: session.user.id }, data: { anonId } }),
    prisma.savedSearch.updateMany({ where: { anonId }, data: { userId: session.user.id, anonId: null } }),
    prisma.jobInteraction.updateMany({ where: { ownerKey: anonId }, data: { ownerKey: session.user.id } }),
    prisma.hiddenCompany.updateMany({ where: { ownerKey: anonId }, data: { ownerKey: session.user.id } }),
  ]);
  return Response.json({ ok: true });
}
```

**Client trigger:** in a new `useMergeOnSignIn` hook called from the header — when `useSession()` flips to authenticated and `localStorage.openrolekb_anon_id` is set, POST it once and clear the localStorage key.

### 5.5 UI

**File:** `src/components/SignInModal.tsx` (new) — `<dialog>`-based modal with one email input. Calls `signIn("email", { email })` from Auth.js.

**File:** `src/components/UserMenu.tsx` (new) — replaces the placeholder header link. Avatar (initial fallback) → dropdown with `Saved`, `Settings`, `Sign out`.

**File:** `src/app/layout.tsx` — wrap `<body>` in a `SessionProvider`. Header switches between `Sign in` button and `UserMenu` based on session.

### 5.6 Tests

- `merge.test.ts`: seed an anon `SavedSearch` and a `JobInteraction`, call `/api/auth/merge`, assert ownership transferred.
- `auth.test.ts`: e2e via Playwright is over-scoped for MVP2. Skip.

### 5.7 Verify

1. From a fresh browser, save an anon search.
2. Click `Sign in`, enter an email, click the link in the inbox (or Resend dashboard) → land back at `/`.
3. The previously-anon saved search appears under your account.
4. `localStorage.openrolekb_anon_id` is gone.
5. `psql -c "SELECT email, anonId FROM \"User\";"` shows your anonId backfilled.


---

## Phase 6 — Cross-device transfer code (~2h)

Depends on phase 5 (uses the same `getOwnerKey` resolver and the merge transaction's anonId-rewrite primitive).

### 6.1 Schema migration

```prisma
model TransferCode {
  code      String   @id   // 6 chars, uppercase, no 0/O/I/L/1
  anonId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([expiresAt])
}
```

```bash
npx prisma migrate dev --name add_transfer_code
```

### 6.2 Code generator

**File:** `src/lib/transfer-code.ts` (new)

```ts
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 30 chars, ambiguous removed
import { randomInt } from "node:crypto";

export function generateTransferCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}
```

Collision odds at 6 chars × 30 alphabet = 729M codes. With ≤1k active codes at any time and a 10-minute TTL, the birthday-paradox collision rate is negligible — but the route still loops on collision (rare) up to 5 attempts.

### 6.3 API routes

**File:** `src/app/api/transfer-code/route.ts` (new)

```ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { generateTransferCode } from "@/lib/transfer-code";

const TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const anonId = req.headers.get("x-anon-id");
  if (!anonId || !/^[0-9a-f-]{36}$/.test(anonId)) {
    return new Response("anon-id required", { status: 400 });
  }
  const { ok } = await rateLimit(req, `transfer-gen:${anonId}`); // 3/hour limit applied via Upstash bucket
  if (!ok) return new Response("rate limited", { status: 429 });

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateTransferCode();
    try {
      const row = await prisma.transferCode.create({
        data: { code, anonId, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      return Response.json({ code: row.code, expiresAt: row.expiresAt });
    } catch (err: unknown) {
      // collision on PK — retry with a fresh code
      if (isPrismaUniqueError(err)) continue;
      throw err;
    }
  }
  return new Response("could not allocate code", { status: 500 });
}
```

**File:** `src/app/api/transfer-code/redeem/route.ts` (new)

```ts
export async function POST(req: NextRequest) {
  const { ok } = await rateLimit(req); // 5/min IP limit via existing limiter
  if (!ok) return new Response("rate limited", { status: 429 });

  const { code } = await req.json();
  if (typeof code !== "string" || !/^[A-Z0-9]{6}$/.test(code)) {
    return new Response("invalid code", { status: 400 });
  }

  const row = await prisma.transferCode.findUnique({ where: { code } });
  if (!row || row.expiresAt < new Date()) {
    return new Response("not found or expired", { status: 404 });
  }

  // Single-use: delete in the same transaction as a no-op so concurrent redemptions can't both succeed
  await prisma.transferCode.delete({ where: { code } });
  return Response.json({ anonId: row.anonId });
}
```

The receiving client overwrites its `localStorage.openrolekb_anon_id` with the returned `anonId` and refreshes. No server-side data moves — both devices' future writes hit the same anonId, so all existing `JobInteraction`/`SavedSearch`/`HiddenCompany` rows resolve unchanged.

### 6.4 UI

**File:** `src/components/TransferCodeMenu.tsx` (new) — two modal states.

- **Generate:** triggered from the header dropdown when there's anon state. Calls `POST /api/transfer-code`. Shows the 6-char code in a large monospace block + a copy button + a "Expires in 9:54" countdown.
- **Redeem:** triggered from the header dropdown's `Have a transfer code?` link. 6-char input (auto-uppercase, paste-friendly). On success, write the returned `anonId` to localStorage, dispatch `openrolekb:saved-changed` so `SavedSearches` refetches, close modal, show a "Now in sync" toast.

Hide the menu item entirely if the user is signed in (transfer is anon-only — signed-in users sync via login).

### 6.5 Cleanup

Add `prisma.transferCode.deleteMany({ where: { expiresAt: { lt: new Date() } } })` to the existing cache-purge cron (§2.1). Keeps the table small without a separate cron.

### 6.6 Tests

- `transfer-code.test.ts`: generate → redeem returns the original `anonId`; second redemption returns 404; expired code returns 404; invalid format returns 400.
- `transfer-code.gen.test.ts`: `generateTransferCode()` only contains chars from the unambiguous alphabet, length 6.

### 6.7 Verify

1. From a fresh anon session, save a search. Open the header dropdown, click `Transfer to another device` → see a code, e.g. `KJ7M2P`.
2. Open an incognito window (different `anonId`). Click `Have a transfer code?`, type the code → page refreshes, shows the saved search from device A.
3. Try the same code in a third window → 404.
4. Generate 4 codes in 1 hour from device A → 4th request returns 429.

## Phase 7 — Quality pass (~4h)

### 7.1 Pagination to 50 with `Show more`

**File:** `src/lib/exa.ts` — bump `numResults: 25` → `numResults: 50`.

**File:** `src/components/ResultsList.tsx` — track `visibleCount` (default 25). Render only `[0..visibleCount)`. Add a `Show more` button at the bottom that bumps `visibleCount` by 25 (max 50).

**File:** `src/lib/cache.ts` — caches the full 50 unchanged.

Migration impact on the rerank prompt: at 50 items the prompt stays under DeepSeek's context limit (each item ~150 tokens × 50 ≈ 7.5k tokens, well within budget). If latency creeps, drop the snippet length in `rerank.ts:53` from 400 → 250 chars.

### 7.2 Freshness line + sort toggle

**File:** `src/components/ResultRow.tsx` — extend the company·location line to `Acme · Berlin · 4d ago` using a small `relativeTime(date)` helper in `src/lib/time.ts`.

**File:** `src/components/ResultsList.tsx` — header above the list:
```
[ Best match ▾ ]    18 results
  ├ Best match     (default — current rerank order)
  └ Newest         (sort by Job.publishedAt desc, nulls last)
```
Sort happens client-side; nothing changes server-side.

### 7.3 ATS allowlist additions

**File:** `src/lib/exa.ts` — extend `ATS_DOMAINS`:
```ts
"myworkdayjobs.com",
"smartrecruiters.com",
"bamboohr.com",
"recruitee.com",
"personio.de",
"teamtailor.com",
```

**File:** `src/lib/company.ts` — add URL parsers for each (mirror the existing greenhouse/lever/ashby patterns). Add `scripts/test-company.ts` covering 2-3 real URLs per source.

### 7.4 Cheap location regex

**File:** `src/lib/location.ts` (new)

```ts
const LOCATION_RX = /(?:Location|Based in|Office|Working from)\s*[:\-–]\s*([A-Z][\w ,/&-]{1,60})/i;
const REMOTE_RX = /\b(fully remote|remote-first|remote\s*[-–]\s*\w+|work from anywhere)\b/i;

export function extractLocation(text: string): { location: string | null; isRemote: boolean } {
  const loc = text.match(LOCATION_RX)?.[1]?.trim() ?? null;
  const isRemote = REMOTE_RX.test(text);
  return { location: loc, isRemote };
}
```

**File:** `src/lib/cache.ts` — call this when populating new `Job` rows. `location` and a new `isRemote: Boolean?` column on `Job`.

```bash
npx prisma migrate dev --name add_job_location_remote
```

Backfill is optional — old rows stay `null` and get filled on next cache miss.

### 7.5 Tests

- `location.test.ts`: 5 fixture excerpts → expected `{ location, isRemote }`.
- `company.test.ts`: extend with the 6 new ATS hosts.

### 7.6 Verify

1. Run a query that previously returned ≥25 results. Click `Show more` → 25 more appear, no flicker.
2. Toggle `Newest` → list reorders by date.
3. Run a query like "data engineer in london". Open the detail pane on a Greenhouse posting; verify `Job.location = "London"` was extracted.
4. Run a query for a Workday-hosted role. Verify the row shows up and links out to `myworkdayjobs.com`.


---

## Phase 8 — Observability (~3h)

### 8.1 Sentry

```bash
npx @sentry/wizard@latest -i nextjs
```

The wizard creates `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, and updates `next.config.ts`. Review each before committing — the wizard's defaults are fine for MVP2.

Tag every `Sentry.captureException` site with stable context:

```ts
// src/lib/observe.ts (new)
import * as Sentry from "@sentry/nextjs";

export function captureRouteError(err: unknown, ctx: {
  route: string;
  ownerKey?: string | null;
  cacheHit?: boolean;
  phase?: "parse" | "exa" | "rerank" | "cache";
}) {
  Sentry.captureException(err, {
    tags: { route: ctx.route, phase: ctx.phase ?? "unknown", cacheHit: String(ctx.cacheHit ?? false) },
    user: ctx.ownerKey ? { id: ctx.ownerKey } : undefined,
  });
}
```

**Don't log raw queries.** Users may paste resumes or PII. Tag with `route` and `phase`, never `rawQuery`.

Wrap all the existing `try/catch` blocks in `/api/search/route.ts`. The Exa and rerank failure paths already swallow errors silently — that's fine for UX, but they should still hit Sentry.

### 8.2 Latency metrics

**File:** `src/app/api/search/route.ts` — record timings on each phase, emit a single JSON log line per request:

```ts
const t0 = performance.now();
// ... phases
const tParse = performance.now();
// ... etc
console.log(JSON.stringify({
  evt: "search",
  ownerKey: ownerKey ?? null,
  cacheHit: !!cached,
  resultCount: reranked.length,
  parseMs: Math.round(tParse - t0),
  exaMs: Math.round(tExa - tParse),
  rerankMs: Math.round(tRerank - tExa),
  totalMs: Math.round(performance.now() - t0),
}));
```

Vercel's log drain captures these. For richer querying, add a Logflare or Axiom drain (free tier) — but a single grep over `evt:"search"` is enough for MVP2.

### 8.3 `/admin/health`

**File:** `src/app/admin/health/page.tsx` (new) — admin-gated server component that pulls the last 100 search log entries from `EventLog` (a tiny new table populated by the same code that writes the JSON log line, so the admin doesn't need a third-party log drain).

```prisma
model EventLog {
  id         String   @id @default(cuid())
  evt        String
  ownerKey   String?
  cacheHit   Boolean
  resultCount Int
  parseMs    Int
  exaMs      Int
  rerankMs   Int
  totalMs    Int
  createdAt  DateTime @default(now())

  @@index([evt, createdAt])
}
```

```bash
npx prisma migrate dev --name add_event_log
```

The page renders summary stats:
- Last hour: count, p50/p95/p99 totalMs, cache-hit rate
- Last 24h: same, plus rerank-error count
- Sparkline of totalMs (last 100 events)

Tail this manually after a deploy. Don't grow it into a dashboard — MVP2 is "is the thing on fire", not "what's our weekly SLA."

### 8.4 Health endpoint

**File:** `src/app/api/health/route.ts` (new) — returns `{ status: "ok", db: true|false, redis: true|false }`. Used by Vercel's health checks and any future uptime monitor. Doesn't query Exa or DeepSeek (too expensive to call on a heartbeat).

### 8.5 Tests

- `observe.test.ts`: sanity-check that `captureRouteError` includes the right tags by spying on `Sentry.captureException`.

### 8.6 Verify

1. Force an Exa failure: temporarily set `EXA_API_KEY=garbage`, run a search. UI shows the existing error banner. Sentry receives an event tagged `route=/api/search, phase=exa`. Restore the key.
2. `curl http://localhost:3000/api/health` → `{ status: "ok", db: true, redis: true }`.
3. Run 5 searches. `/admin/health` shows 5 rows with realistic timings.

---

## 9. Migration sequencing

Each migration is **independently deployable**. Don't bundle. After each, deploy the corresponding feature behind a flag and verify in production for ≥48h before flipping the flag on globally.

| Order | Migration name | Phase | Adds | Reversible? |
|---|---|---|---|---|
| 1 | `add_job_interactions` | 3 | `JobInteraction`, `HiddenCompany`, `Job.interactions` back-relation | Yes — `DROP TABLE` |
| 2 | `add_feedback_events` | 4 | `FeedbackEvent` | Yes |
| 3 | `add_user_auth` | 5 | `User`, `Account`, `Session`, `VerificationToken`, `SavedSearch.userId` | Risky — once users exist, rollback loses signups. Snapshot the `User` table before disabling. |
| 4 | `add_transfer_code` | 6 | `TransferCode` | Yes |
| 5 | `add_job_location_remote` | 7 | `Job.location` (already exists, just used now), `Job.isRemote` | Yes |
| 6 | `add_event_log` | 8 | `EventLog` | Yes |

Do not run migrations 4-6 against prod until #3 is verified — each depends on `User`/`SavedSearch.userId`.

---

## 10. Rollout checklist (production)

For each phase, before merging to `main`:

- [ ] Migration runs cleanly on a copy of prod data (`pg_dump` → restore → `prisma migrate deploy`).
- [ ] Tests pass in CI.
- [ ] Vercel preview deploy of the PR passes the phase's verify steps.
- [ ] Feature flag (`MVP2_<FEATURE>=on`) is **off** in prod env vars.
- [ ] PR description includes the verification steps and a rollback procedure (revert + `prisma migrate resolve --rolled-back`).

After merge:

- [ ] Promote to prod with the flag still off. Confirm zero behavior change.
- [ ] Flip the flag for the `ADMIN_EMAIL` user only (a `if (allowedForUser(session)) ...` gate).
- [ ] After 24h with no Sentry spikes, flip the flag globally.
- [ ] After 48h, open a follow-up PR removing the flag (no behavior change expected; just cleanup).

---

## 11. Rollback playbook

Things that can go wrong and what to do.

**Auth rollout breaks anon flow.**
Symptom: signed-out users can't save. Cause: `getOwnerKey` regression.
Fix: revert phase 5 PR; the `anonId` columns on `SavedSearch` etc. were never dropped, so anon writes resume working immediately.

**Transfer code redeems on two devices simultaneously.**
Symptom: two devices both claim success on the same code.
Cause: redemption not single-use.
Fix: rely on the unique-PK `delete` in the redeem route — `prisma.transferCode.delete({ where: { code } })` will throw on the second redemption because the row is gone. Don't read-then-delete in two steps. Phase 6 §6.3 already specifies this — verify the route does not re-read the row after delete.

**Hide-company filter accidentally hides everything.**
Symptom: signed-in users see empty result lists for queries that work for anon.
Cause: `extractCompany` returning a value that matches a hidden entry's lowercase form despite a casing mismatch.
Fix: add a regression test fixture; ensure both sides of the comparison use `.toLowerCase()`. Phase 3 §3.2 already specifies this — verify in code review.

**Upstash quota exceeded.**
Symptom: every request returns 429.
Fix: temporarily revert phase 2.2 (in-memory limiter) via env-var toggle: `RATE_LIMIT_BACKEND=memory|upstash`. Keep both implementations behind the toggle until you've sized your Upstash plan.

**Resend bounces magic-link emails.**
Symptom: sign-in emails never arrive.
Fix: domain DKIM/SPF probably not propagated. Use Resend's onboarding domain (`onboarding@resend.dev`) as a fallback `RESEND_FROM` until your custom domain is verified. Don't ship to prod until your real domain is verified.

---

## 12. Open questions

All resolved. Kept here as a record of the trade-offs and what was deferred. Re-open any of these when scoping MVP3.

1. **Does anon flow expire?** ✅ **Decided: yes — 30 days of inactivity.** Anon `SavedSearch`, `JobInteraction`, and `HiddenCompany` rows are purged 30 days after their most recent `createdAt` (or `updatedAt` if added). Implemented as additional sweeps in the cache-purge cron (§2.1) — extend the handler with three `deleteMany` calls scoped to `userId IS NULL` / `ownerKey NOT IN (SELECT id FROM "User")`. Add a regression test that signs in within 30 days and confirms the merge transaction still finds the rows.
2. **Cross-device sync without sign-in?** ✅ **Decided: yes — transfer code.** Implemented as Phase 6 (§6 above). 6-char single-use codes, 10-minute TTL, 3/hour generate limit per anonId, 5/min redeem limit per IP.
3. ~~Email digest vs. immediate alerts.~~ ✂️ **Cut from MVP2 along with the entire alerts feature.** Revisit in MVP3.
4. **`ADMIN_EMAILS` vs. a real role column.** ✅ **Decided: single `ADMIN_EMAIL` env var.** One person reads `/admin/feedback` and `/admin/health`. Promote to a `User.role` enum the moment a second admin is needed — not before.
5. ~~Alert email branding.~~ ✂️ **Cut.** No alert emails in MVP2. Resend is used only for the magic-link sign-in template, which can stay plain.

All decisions are reflected in `mvp2.md` (§Goals, §1.1, §1.6, §3 build order, §4.1, §9 MVP3).

---

## 13. Total estimate

| Phase | Hours (focused) | Risk multiplier |
|---|---|---|
| 1. Tests | 2 | 1.0× |
| 2. Cron + rate limit | 2 | 1.0× |
| 3. Per-job state | 6 | 1.2× |
| 4. Feedback | 3 | 1.0× |
| 5. Auth + Resend (magic-link only) | 5 | **1.5×** |
| 6. Transfer code | 2 | 1.1× |
| 7. Quality | 4 | 1.2× |
| 8. Observability | 3 | 1.0× |

Raw total: 27h. Risk-adjusted: ~33h. At 4 focused hours/day → ~8 working days. Phase 5 (auth) carries the most surprise; if it overruns, defer phase 7 to MVP2.5 rather than cutting verification corners on auth. Cutting alerts saved roughly 9h of risk-adjusted scope.


---

## 14. Decisions on small items

These are the calls I made on the small open items raised after the plan was drafted. Each lands in a specific phase — pointers below.

### 14.0 Auth.js v5 with Prisma 7 — verify, then vendor

**Decision:** verify compatibility in Phase 1 with a 30-minute smoke test. If `@auth/prisma-adapter` works against Prisma 7 (likely — the adapter touches a stable subset of the Prisma client API), proceed as planned. If it doesn't, vendor a custom adapter rather than downgrading Prisma.

**Why:** Prisma 7 was a deliberate stack choice. The Auth.js adapter interface has ~14 methods, most one-liners (`createUser`, `getUser`, `linkAccount`, `createSession`, …). Inlining is cheaper than fighting peer-dep ranges, and a vendored adapter survives future Auth.js minor bumps.

**Action in Phase 1:** add a sub-task before the rest of Phase 1 starts:

```bash
npm install next-auth@beta @auth/prisma-adapter
# write a 20-line script that imports PrismaAdapter(prisma) and calls
# adapter.createUser({ email: "test@example.com" }) against a scratch DB
# pass: proceed as planned. fail: implement vendored adapter at src/lib/auth-adapter.ts
```

Time-box 30 min. If vendoring is needed, budget +2h on Phase 5.

### 14.1 Owner-key normalization (Phase 3 + Phase 5)

**Decision:** all `ownerKey` writes go through a single `normalizeOwnerKey()` helper. Invalid input rejects at the route boundary with 400.

**Why:** `ownerKey` is a free-form `String` column, so a casing or formatting drift silently corrupts indexes and breaks the `@@unique` constraints on `JobInteraction`. Cheap to enforce, expensive to backfill later.

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

### 14.2 SavedSearch dedupe at merge time (Phase 5)

**Decision:** add `@@unique([userId, queryHash])` to `SavedSearch` (and the parallel anon constraint via partial index on `(anonId, queryHash) WHERE anonId IS NOT NULL`). On merge, use `createMany({ skipDuplicates: true })` semantics — Prisma equivalent is to query-then-`createMany` with `skipDuplicates: true`.

**Why:** without a constraint, an anon user who saved "react remote" and then signs in to an account that already saved "react remote" gets two rows in the saved-strip UI. With it, the merge silently keeps one. Use `queryHash` (already produced by `lib/hash.ts`) instead of `rawQuery` so case and whitespace differences collapse.

**Schema delta** (rolls into `add_user_auth`):

```prisma
model SavedSearch {
  // ... existing
  queryHash String   // sha256(normalizedQuery + filters), stable
  @@unique([userId, queryHash])
  @@index([anonId, queryHash])  // can't enforce uniqueness across nullable userId, partial index instead
}
```

Plus a raw-SQL migration for the partial unique index:
```sql
CREATE UNIQUE INDEX saved_search_anon_unique ON "SavedSearch"("anonId", "queryHash") WHERE "anonId" IS NOT NULL;
```

**Backfill:** existing rows compute `queryHash` once. Run as part of the migration.

### 14.3 Hidden-company casing (Phase 3 + Phase 7)

**Decision:** lowercase on both write and read. Phase 7 adds one fixture per ATS host with a known-tricky-casing example (e.g. Workday's `acmeRobotics` slug).

**Where it lands:**
- `extractCompany(url)` returns whatever the URL has. Unchanged.
- Every `HiddenCompany.company` write uses `.toLowerCase()`.
- The hide filter in `/api/search` compares `extractCompany(r.url)?.toLowerCase()` against the stored lowercase set. Already specified in Phase 3 §3.4.
- Phase 7 §7.5 adds one casing-edge-case fixture per new ATS host.

### 14.4 `/api/me/saved-jobs` does NOT filter hidden companies (Phase 3)

**Decision:** the `/saved` page shows everything the user explicitly saved, even if the company is now hidden. Saved overrides hide.

**Why:** the user took an explicit action ("save this job"). Silently hiding it later because they hid the company elsewhere is surprising and unrecoverable from their POV. Hide is a search-results filter, not a global blacklist.

**Where it lands:** `src/app/api/me/saved-jobs/route.ts` gets a one-line code comment so it doesn't get "fixed" in a future PR:

```ts
// Intentional: saved jobs are NOT filtered by HiddenCompany. User explicitly
// saved this; their later hide of the company should not retroactively erase it.
```

### 14.5 Rate-limit helpers split by purpose (Phase 6)

**Decision:** `lib/rate-limit.ts` exports named limiters per use case rather than one generic function. Phase 6's transfer-code routes call dedicated ones.

**Why:** the original `rateLimit(req, ownerKey?)` couldn't express "3/hour per anonId for code generation" without baking the bucket config in. Named exports are clearer at the call site and harder to misuse.

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

### 14.6 Sentry sampling + PII redaction (Phase 8)

**Decision:** explicit `tracesSampleRate` per environment, `beforeSend` hook that scrubs PII fields. Add a one-line PR-template checklist item: "no `email` or `rawQuery` in Sentry tags."

**Why:** Sentry's defaults (1.0 tracesSampleRate everywhere) blow up the free quota fast in prod. PII in tags is indexed and searchable — even a one-time leak survives in their database long-term.

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

### 14.7 Prisma type barrel (Phase 1, applied as touched)

**Decision:** re-export the `Prisma` namespace from `src/lib/prisma.ts` so new code imports from `@/lib/prisma` instead of `../../generated/prisma/client`. Existing `cache.ts` import stays — don't mass-rename.

**Why:** future migrations may move the generator output. One barrel is one place to fix. Also: `@/lib/prisma` is the canonical Prisma access point in this repo, and types should follow the same path.

**File:** `src/lib/prisma.ts` — append:

```ts
export type { Prisma } from "../../generated/prisma/client";
```

Then in new files (Phase 3 onwards):

```ts
import { prisma, type Prisma } from "@/lib/prisma";
```

Lint rule (optional, low priority): a custom ESLint rule banning `from ".*generated/prisma"` imports outside `lib/prisma.ts`. Skip for MVP2; add to MVP3 when the codebase is bigger.

