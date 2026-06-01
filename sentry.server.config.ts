import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
const release = process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE;

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers["cookie"];
          delete event.request.headers["authorization"];
          delete event.request.headers["x-anon-id"];
        }
        if (event.request.data && typeof event.request.data === "object") {
          const data = event.request.data as Record<string, unknown>;
          if ("query" in data) data.query = "<redacted>";
          if ("rawQuery" in data) data.rawQuery = "<redacted>";
        }
      }
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
      }
      const scrubMessage = (msg?: string) =>
        msg?.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>");
      if (event.message) event.message = scrubMessage(event.message) ?? event.message;
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = scrubMessage(ex.value);
        }
      }
      return event;
    },
  });
}
