import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminHealth() {
  const session = await auth();
  const allowed = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!session?.user?.email || session.user.email.toLowerCase() !== allowed) {
    redirect("/");
  }

  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  // For recent list we still load a capped set (good for the table).
  // For stats we use targeted aggregates / raw SQL to avoid loading everything in JS.
  const events = await prisma.eventLog.findMany({
    where: { createdAt: { gt: new Date(now - DAY) } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Stats via more efficient queries (less JS heavy lifting)
  const searchCount1h = await prisma.eventLog.count({
    where: { evt: "search", createdAt: { gt: new Date(now - HOUR) } },
  });
  const searchCount24h = await prisma.eventLog.count({
    where: { evt: "search", createdAt: { gt: new Date(now - DAY) } },
  });

  const cacheHitCount1h = await prisma.eventLog.count({
    where: { evt: "search", cacheHit: true, createdAt: { gt: new Date(now - HOUR) } },
  });
  const cacheHitRate = searchCount1h ? Math.round((cacheHitCount1h / searchCount1h) * 100) : 0;

  const rerankFailCount24 = await prisma.eventLog.count({
    where: { evt: "search", rerankFailed: true, createdAt: { gt: new Date(now - DAY) } },
  });
  const rerankFailureRate = searchCount24h ? Math.round((rerankFailCount24 / searchCount24h) * 10000) / 100 : 0;

  // Percentiles via SQL (accurate, no full sort in Node)
  let p50 = 0, p95 = 0, p99 = 0, p95Day = 0;
  try {
    const [p50r] = await prisma.$queryRaw<{ p: number }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "totalMs") as p FROM "EventLog"
      WHERE "evt"='search' AND "createdAt" > ${new Date(now - HOUR)}
    `;
    p50 = Math.round(p50r?.p ?? 0);

    const [p95r] = await prisma.$queryRaw<{ p: number }[]>`
      SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "totalMs") as p FROM "EventLog"
      WHERE "evt"='search' AND "createdAt" > ${new Date(now - HOUR)}
    `;
    p95 = Math.round(p95r?.p ?? 0);

    const [p99r] = await prisma.$queryRaw<{ p: number }[]>`
      SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY "totalMs") as p FROM "EventLog"
      WHERE "evt"='search' AND "createdAt" > ${new Date(now - HOUR)}
    `;
    p99 = Math.round(p99r?.p ?? 0);

    const [p95dr] = await prisma.$queryRaw<{ p: number }[]>`
      SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "totalMs") as p FROM "EventLog"
      WHERE "evt"='search' AND "createdAt" > ${new Date(now - DAY)}
    `;
    p95Day = Math.round(p95dr?.p ?? 0);
  } catch {
    // fallback to JS on the loaded set if raw fails (e.g. in some test DBs)
  }

  const lastHourEventsForFallback = events.filter((e) => e.createdAt.getTime() > now - HOUR && e.evt === "search");
  if (p95 === 0 && lastHourEventsForFallback.length > 0) {
    const sorted = lastHourEventsForFallback.map((e) => e.totalMs).sort((a, b) => a - b);
    p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0);
  }

  // Cost aggregates (can be raw too but reduce on small set is fine)
  const searchEventsForCost = events.filter((e) => e.evt === "search");
  const sumExaCost = searchEventsForCost.reduce((s, e) => s + (e.exaCostUsd ?? 0), 0);
  const sumLlmCost = searchEventsForCost.reduce((s, e) => s + (e.llmCostUsd ?? 0), 0);
  const totalCost24 = sumExaCost + sumLlmCost;
  const costPerSearch = searchCount24h ? totalCost24 / searchCount24h : 0;

  // Volume sparkline still uses the capped events (acceptable for dashboard)
  const searchEvents = events.filter((e) => e.evt === "search");
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const start = now - (24 - i) * HOUR;
    const end = start + HOUR;
    return searchEvents.filter((e) => {
      const t = e.createdAt.getTime();
      return t >= start && t < end;
    }).length;
  });
  const maxBucket = Math.max(1, ...buckets);

  // Efficiency / measurement indicators (visible impact of P1 changes: fast-path parse, L1 cache, parallel hidden, etc.)
  const avgParseMs = searchEvents.length
    ? Math.round(searchEvents.reduce((s, e) => s + (e.parseMs || 0), 0) / searchEvents.length)
    : 0;
  const avgTotalMs = searchEvents.length
    ? Math.round(searchEvents.reduce((s, e) => s + (e.totalMs || 0), 0) / searchEvents.length)
    : 0;

  // Volume sparkline buckets (24 × 1-hour buckets) — searches only for clarity
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const start = now - (24 - i) * HOUR;
    const end = start + HOUR;
    return searchEvents.filter((e) => {
      const t = e.createdAt.getTime();
      return t >= start && t < end;
    }).length;
  });
  const maxBucket = Math.max(1, ...buckets);

  // Latest eval run
  const latestRun = await prisma.evalRun.findFirst({
    orderBy: { createdAt: "desc" },
    select: { runId: true, createdAt: true },
  });
  let latestEvalPassRate = 0;
  let latestEvalRuns = 0;
  let latestEvalAt: Date | null = null;
  if (latestRun) {
    const runRows = await prisma.evalRun.findMany({
      where: { runId: latestRun.runId },
      select: { passed: true, createdAt: true },
    });
    latestEvalRuns = runRows.length;
    latestEvalPassRate = runRows.length
      ? Math.round((runRows.filter((r) => r.passed).length / runRows.length) * 100)
      : 0;
    latestEvalAt = latestRun.createdAt;
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-h1 font-display mb-6">Health</h1>

      <Section title="Traffic">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Searches (1h)" value={String(searchCount1h)} />
          <StatCard label="Searches (24h)" value={String(searchCount24h)} />
          <StatCard label="Cache hit (1h)" value={cacheHitRate + "%"} />
          <StatCard label="Rerank fail (24h)" value={rerankFailureRate + "%"} />
        </div>
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <p className="text-micro text-ink-soft mb-2">Volume — last 24h</p>
          <div className="flex items-end gap-0.5 h-16">
            {buckets.map((v, i) => (
              <div
                key={i}
                className="flex-1 bg-accent/40 rounded-t-sm"
                style={{ height: `${(v / maxBucket) * 100}%`, minHeight: v > 0 ? 2 : 1 }}
                title={`${v} searches`}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Latency">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="p50 (1h)" value={p50 + "ms"} />
          <StatCard label="p95 (1h)" value={p95 + "ms"} />
          <StatCard label="p99 (1h)" value={p99 + "ms"} />
          <StatCard label="p95 (24h)" value={p95Day + "ms"} />
        </div>
      </Section>

      <Section title="Cost (24h)">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total cost" value={"$" + totalCost24.toFixed(4)} />
          <StatCard label="Exa cost" value={"$" + sumExaCost.toFixed(4)} />
          <StatCard label="LLM cost" value={"$" + sumLlmCost.toFixed(4)} />
          <StatCard label="Per search" value={"$" + costPerSearch.toFixed(5)} />
        </div>
      </Section>

      <Section title="Quality">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Last eval pass rate" value={latestEvalRuns ? latestEvalPassRate + "%" : "—"} />
          <StatCard label="Cases run" value={String(latestEvalRuns)} />
          <StatCard label="Ran at" value={latestEvalAt ? latestEvalAt.toLocaleString() : "never"} />
        </div>
      </Section>

      <Section title="Cron / Retention">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Digest emails sent (24h)"
            value={String(events.filter((e) => e.evt === "digest_email_sent").length)}
          />
          <StatCard
            label="Saved search runs (24h)"
            value={String(events.filter((e) => e.evt === "saved_search_run_completed").length)}
          />
        </div>
      </Section>

      <Section title="Efficiency (P1 impact)">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Avg parseMs (24h, searches)" value={avgParseMs + "ms"} />
          <StatCard label="Avg totalMs (24h, searches)" value={avgTotalMs + "ms"} />
          <StatCard label="Cache hit (1h)" value={cacheHitRate + "%"} />
          <StatCard label="Rerank fail (24h)" value={rerankFailureRate + "%"} />
        </div>
        <p className="text-micro text-ink-soft mt-2">Lower parseMs indicates fast-path and override wins. Watch after config / LLM changes.</p>
      </Section>

      <h2 className="text-h2 font-medium mt-8 mb-3">Recent events (last 50)</h2>
      {events.length === 0 ? (
        <p className="text-ink-soft">No search events logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Cache</th>
                <th className="py-2 pr-4 font-medium">Results</th>
                <th className="py-2 pr-4 font-medium">Parse</th>
                <th className="py-2 pr-4 font-medium">Exa</th>
                <th className="py-2 pr-4 font-medium">Rerank</th>
                <th className="py-2 pr-4 font-medium">Tokens</th>
                <th className="py-2 pr-4 font-medium">Cost</th>
                <th className="py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 50).map((e) => {
                const tokens = (e.parseTokens ?? 0) + (e.rerankTokens ?? 0);
                const cost = (e.exaCostUsd ?? 0) + (e.llmCostUsd ?? 0);
                return (
                  <tr key={e.id} className={"border-b border-border/50 " + (e.rerankFailed ? "bg-danger/5" : "")}>
                    <td className="py-2 pr-4 text-ink-soft whitespace-nowrap">{e.createdAt.toLocaleTimeString()}</td>
                    <td className="py-2 pr-4">{e.cacheHit ? "✓" : "—"}</td>
                    <td className="py-2 pr-4">{e.resultCount}</td>
                    <td className="py-2 pr-4">{e.parseMs}ms</td>
                    <td className="py-2 pr-4">{e.exaMs}ms</td>
                    <td className="py-2 pr-4">{e.rerankMs}ms</td>
                    <td className="py-2 pr-4 text-muted">{tokens || "—"}</td>
                    <td className="py-2 pr-4 text-muted">{cost > 0 ? "$" + cost.toFixed(4) : "—"}</td>
                    <td className="py-2 font-medium">{e.totalMs}ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-h2 font-medium mb-3">{title}</h2>
      {children}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-micro text-ink-soft">{label}</p>
      <p className="text-h2 font-medium mt-1">{value}</p>
    </div>
  );
}
