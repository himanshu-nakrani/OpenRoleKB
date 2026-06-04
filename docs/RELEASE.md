# Release runbook

Repeatable steps for promoting `main` to production. Follow in order. If any step
fails, stop and triage before continuing — never skip migrations or telemetry checks.

## 1. Pre-flight (every release)

```bash
npm ci
npm run lint
npx tsc --noEmit
npm test
```

All four must pass green. CI does this on every PR but verifying locally before promotion
catches anything that snuck in via a force-push or hotfix.

## 2. Database migrations

Run **before** the new app code is serving traffic, so the schema is forward-compatible
with both old and new app versions during the rolling deploy.

```bash
DATABASE_URL=<production-url> npx prisma migrate deploy
```

The `migrate deploy` command applies every unapplied migration in
`prisma/migrations/` in order. It is idempotent: running it twice is safe.

### Current pending migrations

If you're deploying from a tag older than `2026-06-02`, the following must be applied:

- `20260602000000_savedsearch_unique_anon_and_eventlog_fields`
  - Dedupes existing `SavedSearch` rows by `(anonId, queryHash)`.
  - Adds unique index `SavedSearch_anonId_queryHash_key`.
  - Adds `EventLog.rerankFailed BOOLEAN NOT NULL DEFAULT false`.
  - Adds `EventLog.cacheMs INTEGER DEFAULT 0`.

Without this migration, `POST /api/saved` will throw on duplicate saves from anonymous
users and `EventLog` writes from the new app will fail.

## 3. Cron & Resend email setup (one-time per domain / first deploy of digests)

The saved-search digest cron (`/api/cron/saved-search-run`) is scheduled in `vercel.json`.
Cache purge runs nightly; the digest runner runs daily at 14:17 UTC (odd minute to avoid stampede).

1. Ensure `CRON_SECRET` (strong random) and `RESEND_FROM` (verified sender, e.g. `hello@yourdomain.com`) are set in Vercel environment variables.
2. In Resend dashboard: verify the domain for `RESEND_FROM`, and configure DKIM + DMARC (follow Resend's DNS instructions). This is required for deliverability and to avoid spam folder.
3. For initial rollout (first 7+ days), set `EMAIL_TEST_MODE=true` in production env so digests only go to `ADMIN_EMAIL` (prevents blasting real users while validating).
4. After confidence, remove or set `EMAIL_TEST_MODE=false`.

The route will log a warning and skip sending if `RESEND_FROM` is unset (see `src/app/api/cron/saved-search-run/route.ts`).

## 4. Deploy

Push `main` to the Vercel-tracked branch. Vercel will build and roll out automatically.
The build runs `next build`; if it fails, the new deployment is not promoted.

## 5. Post-deploy verification

Within 5 minutes of the rollout completing:

1. Hit `/api/health` — should return 200 + a JSON status payload.
2. Hit `/admin/health` — confirm:
   - Cache-hit rate is reasonable for the last hour.
   - `rerankFailed` count is not spiking.
   - Avg `totalMs` is within the previous baseline.
3. Run one real search end-to-end. Confirm SSE events stream in order:
   `parsed → results → rerank → done`.
4. Open Sentry — confirm the release marker for this commit appears in the latest
   release list and no new error spike is firing.
5. (After first digest cron tick) Check that `/api/cron/saved-search-run` (triggered manually with `x-cron-secret: $CRON_SECRET` or via Vercel) behaves correctly in test mode, and emails land in ADMIN_EMAIL.

## 6. Rollback

If anything from §5 fails:

1. Vercel → Deployments → previous green deployment → "Promote to production."
2. If the migration is the culprit, manually reverse it. Migrations are not
   auto-rolled-back; write a follow-up migration that drops/restores the column or
   index.
3. Post-mortem entry in `docs/incidents/<date>.md` within 24 hours.
