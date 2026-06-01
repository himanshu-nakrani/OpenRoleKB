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

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const events = await prisma.eventLog.findMany({
    where: { createdAt: { gt: new Date(now - DAY) } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const lastHour = events.filter((e) => e.createdAt.getTime() > now - HOUR);

  const cacheHitRate = lastHour.length
    ? Math.round((lastHour.filter((e) => e.cacheHit).length / lastHour.length) * 100)
    : 0;

  const totalMsSortedHour = lastHour.map((e) => e.totalMs).sort((a, b) => a - b);
  const totalMsSortedDay = events.map((e) => e.totalMs).sort((a, b) => a - b);
  const p50 = percentile(totalMsSortedHour, 0.5);
  const p95 = percentile(totalMsSortedHour, 0.95);
  const p99 = percentile(totalMsSortedHour, 0.99);
  const p95Day = percentile(totalMsSortedDay, 0.95);

  const rerankFailures24 = events.filter((e) => e.rerankFailed).length;
  const rerankFailureRate = events.length
    ? Math.round((rerankFailures24 / events.length) * 10000) / 100
    : 0;

  const sumExaCost = events.reduce((s, e) => s + (e.exaCostUsd ?? 0), 0);
  const sumLlmCost = events.reduce((s, e) => s + (e.llmCostUsd ?? 0), 0);
  const totalCost24 = sumExaCost + sumLlmCost;
  const costPerSearch = events.length ? totalCost24 / events.length : 0;

  // Volume sparkline buckets (24 × 1-hour buckets)
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const start = now - (24 - i) * HOUR;
    const end = start + HOUR;
    return events.filter((e) => {
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
          <StatCard label="Searches (1h)" value={String(lastHour.length)} />
          <StatCard label="Searches (24h)" value={String(events.length)} />
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

      <h2 className="text-h2 font-medium mt-8 mb-3">Recent searches</h2>
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}
