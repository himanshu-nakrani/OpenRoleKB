export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Warm the Prisma/Postgres connection pool early (Neon serverless cold-start mitigation).
    // Runs on Node runtime init for the instance. See phase3 P3.6 and ARCHITECTURE perf budget.
    // Non-fatal: if DB is unavailable at init we just log and continue (first request will connect).
    try {
      const { prisma } = await import("@/lib/prisma");
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      // Expected in some dev/build scenarios or if DATABASE_URL unset at edge init time.
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
