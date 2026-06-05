import * as Sentry from "@sentry/nextjs";
import { log } from "@/lib/logger";

export type ObservePhase =
  | "parse"
  | "exa"
  | "rerank"
  | "cache"
  | "metrics"
  // Saved-search cron phases
  | "setup"
  | "run"
  | "email";

export function captureRouteError(
  err: unknown,
  ctx: {
    route: string;
    ownerKey?: string | null;
    cacheHit?: boolean;
    phase?: ObservePhase;
    /** Free-form extra context. Sentry tags + structured log. */
    [k: string]: unknown;
  },
) {
  const message = err instanceof Error ? err.message : String(err);
  log.error({
    evt: "route_error",
    route: ctx.route,
    phase: ctx.phase ?? "unknown",
    cacheHit: ctx.cacheHit ?? false,
    ownerKey: ctx.ownerKey ?? null,
    message,
  });
  Sentry.captureException(err, {
    tags: {
      route: ctx.route,
      phase: ctx.phase ?? "unknown",
    },
    extra: {
      ownerKey: ctx.ownerKey ?? null,
      cacheHit: ctx.cacheHit ?? false,
    },
  });
}
