#!/usr/bin/env -S npx tsx
/**
 * Eval-run trend viewer.
 *
 * Usage:
 *   npx tsx scripts/eval-trends.ts                # last 10 runs
 *   npx tsx scripts/eval-trends.ts --runs 20      # last 20 runs
 *   npx tsx scripts/eval-trends.ts --case <name>  # single case across runs
 *
 * Exit codes:
 *   0 — success (including empty DB)
 *   1 — DB error
 */
import { prisma } from "@/lib/prisma";
import type { DimensionResult } from "../test/eval/types";

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const RUNS_N = parseInt(argValue("--runs") ?? "10", 10);
const ONLY_CASE = argValue("--case");

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sparkline(rate: number, width = 15): string {
  const filled = Math.round(rate * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

async function main() {
  // Fetch distinct runIds ordered by createdAt desc, limited to RUNS_N
  const distinctRunRows = await prisma.$queryRaw<Array<{ runId: string; createdAt: Date }>>`
    SELECT DISTINCT ON ("runId") "runId", "createdAt"
    FROM "EvalRun"
    ORDER BY "runId", "createdAt" DESC
  `;

  if (distinctRunRows.length === 0) {
    console.log("No EvalRun rows found. Run scripts/eval.ts first.");
    process.exit(0);
  }

  // Sort by createdAt desc, take last RUNS_N
  distinctRunRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const recentRunIds = distinctRunRows.slice(0, RUNS_N).map((r) => r.runId);

  // Fetch all rows for these runIds
  const allRows = await prisma.evalRun.findMany({
    where: {
      runId: { in: recentRunIds },
      ...(ONLY_CASE ? { caseName: ONLY_CASE } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (allRows.length === 0) {
    if (ONLY_CASE) {
      console.log(`No EvalRun rows found for case "${ONLY_CASE}" in the last ${RUNS_N} runs.`);
    } else {
      console.log("No EvalRun rows found. Run scripts/eval.ts first.");
    }
    process.exit(0);
  }

  // Date range
  const dates = allRows.map((r) => r.createdAt);
  const oldest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const newest = new Date(Math.max(...dates.map((d) => d.getTime())));

  const rangeLabel = `${oldest.toISOString().slice(0, 10)} → ${newest.toISOString().slice(0, 10)}`;
  console.log(`\n▶ EvalRun trends — last ${recentRunIds.length} runs (${rangeLabel})\n`);

  // --- Aggregate per-dimension pass rate ---
  const dimTotals = new Map<string, { pass: number; total: number }>();
  for (const row of allRows) {
    const dims = row.dimensions as DimensionResult[] | null;
    if (!Array.isArray(dims)) continue;
    for (const d of dims) {
      const existing = dimTotals.get(d.name) ?? { pass: 0, total: 0 };
      existing.total += 1;
      if (d.passed) existing.pass += 1;
      dimTotals.set(d.name, existing);
    }
  }

  if (dimTotals.size > 0) {
    console.log("Aggregate per-dimension pass rate:");
    const maxNameLen = Math.max(...Array.from(dimTotals.keys()).map((k) => k.length));
    for (const [name, { pass, total }] of Array.from(dimTotals.entries()).sort()) {
      const rate = total === 0 ? 0 : pass / total;
      const pct = `${Math.round(rate * 100)}%`.padStart(4);
      const bar = sparkline(rate);
      const label = name.padEnd(maxNameLen);
      console.log(`  ${label}  ${bar} ${pct} (${pass}/${total})`);
    }
    console.log("");
  }

  // --- Per-run history (newest first) ---
  console.log("Per-run history (newest first):");
  for (const runId of recentRunIds) {
    const rows = allRows.filter((r) => r.runId === runId);
    if (rows.length === 0) continue;
    const runDate = new Date(Math.max(...rows.map((r) => r.createdAt.getTime())));
    const nCases = rows.length;
    const nPassed = rows.filter((r) => r.passed).length;
    const passRate = nCases > 0 ? (nPassed / nCases) * 100 : 0;
    const avgScore = nCases > 0 ? rows.reduce((s, r) => s + r.score, 0) / nCases : 0;
    const totalCost = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    const costStr = totalCost > 0 ? `  $${totalCost.toFixed(2)}` : "";
    console.log(
      `  ${runId.slice(0, 8)} ${formatDate(runDate)}  ${String(nCases).padStart(2)} cases   pass=${Math.round(passRate)}%  avg=${avgScore.toFixed(2)}${costStr}`,
    );
  }
  console.log("");

  // --- Cases failing in the most recent run ---
  const mostRecentRunId = recentRunIds[0];
  const mostRecentRows = allRows.filter((r) => r.runId === mostRecentRunId && !r.passed);
  if (mostRecentRows.length > 0) {
    console.log("Cases failing in the most recent run:");
    for (const row of mostRecentRows.sort((a, b) => a.score - b.score)) {
      const dims = (row.dimensions as DimensionResult[] | null) ?? [];
      const failedDims = dims.filter((d) => !d.passed).map((d) => d.name);
      const dimStr = failedDims.length > 0 ? ` — ${failedDims.join(", ")}` : "";
      console.log(`  · ${row.caseName} (score=${row.score.toFixed(2)})${dimStr}`);
    }
  } else {
    console.log("All cases passed in the most recent run.");
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
