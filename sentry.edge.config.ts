import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
const release = process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE;

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
