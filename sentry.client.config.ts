import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    tracesSampleRate: 0.05,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
