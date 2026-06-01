#!/usr/bin/env -S npx tsx
/**
 * Search-quality eval runner.
 *
 * Usage:
 *   npx tsx scripts/eval.ts                     # uses Exa snapshots, real DeepSeek
 *   npx tsx scripts/eval.ts --refresh-snapshots # re-fetches Exa for every case
 *   npx tsx scripts/eval.ts --case <name>       # run a single case
 *   npx tsx scripts/eval.ts --dry-run           # parse + score against synthetic rerank; no API calls
 *   npx tsx scripts/eval.ts --no-write          # don't write EvalRun rows
 *
 * Exit codes:
 *   0 — all cases passed
 *   1 — at least one case failed
 *   2 — runner crashed (CI should treat differently)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseQuery } from "@/lib/parse-query";
import { searchJobs } from "@/lib/exa";
import { rerankWithMetrics } from "@/lib/rerank";
import { prisma } from "@/lib/prisma";
import { hasSnapshot, loadSnapshot, writeSnapshot } from "../test/eval/snapshot-cache";
import { scoreCase } from "../test/eval/score";
import type { GoldenCase, CaseResult, EvalReport } from "../test/eval/types";
import type { ExaResult, RerankItem } from "@/types/job";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DRY_RUN = flag("--dry-run");
const REFRESH = flag("--refresh-snapshots");
const NO_WRITE = flag("--no-write");
const ONLY_CASE = argValue("--case");

const DEEPSEEK_USD_PER_1K_TOKENS = 0.00027;

async function exaForCase(c: GoldenCase): Promise<ExaResult[]> {
  if (DRY_RUN || (!REFRESH && hasSnapshot(c.query))) {
    return loadSnapshot(c.query);
  }
  console.error(`  [exa] fetching live for "${c.query}"`);
  const parsed = await parseQuery(c.query);
  const results = await searchJobs(c.query, parsed.filters);
  writeSnapshot(c.query, results);
  return results;
}

function syntheticRerank(exa: ExaResult[]): { items: RerankItem[]; tokens?: number } {
  // Deterministic synthetic: top half scored 0.8, bottom half 0.4. Used in --dry-run
  // so the harness itself can be tested without paying for DeepSeek.
  const items = exa.map((_, idx) => ({
    idx,
    score: idx < exa.length / 2 ? 0.8 : 0.4,
    fit: `synthetic-rank-${idx}`,
  }));
  return { items, tokens: 0 };
}

async function runCase(c: GoldenCase): Promise<CaseResult> {
  const t0 = Date.now();
  const exa = await exaForCase(c);
  const r = DRY_RUN
    ? syntheticRerank(exa)
    : await rerankWithMetrics(c.query, exa);
  const durationMs = Date.now() - t0;
  const tokens = r.tokens;
  const costUsd = tokens != null ? (tokens / 1000) * DEEPSEEK_USD_PER_1K_TOKENS : undefined;
  return scoreCase(c, exa, r.items, durationMs, tokens, costUsd);
}

async function main() {
  const goldensPath = resolve(__dirname, "../test/eval/golden-queries.json");
  const goldens: GoldenCase[] = JSON.parse(readFileSync(goldensPath, "utf-8"));
  const cases = ONLY_CASE ? goldens.filter((g) => g.name === ONLY_CASE) : goldens;
  if (ONLY_CASE && cases.length === 0) {
    console.error(`No case named "${ONLY_CASE}"`);
    process.exit(2);
  }

  const runId = randomUUID();
  const rubricSha = await rubricSignature();
  const startedAt = new Date().toISOString();

  console.error(`▶ Eval run ${runId.slice(0, 8)} — ${cases.length} cases (rubric ${rubricSha.slice(0, 8)})${DRY_RUN ? " [dry-run]" : ""}`);

  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stderr.write(`  ${c.name} ... `);
    try {
      const r = await runCase(c);
      results.push(r);
      console.error(`${r.passed ? "✓" : "✗"} score=${r.score.toFixed(2)} ${r.durationMs}ms ${r.tokens != null ? `${r.tokens}tok` : ""}`);
      if (!r.passed) {
        for (const f of r.failures) console.error(`      · ${f}`);
      }
    } catch (err) {
      console.error(`crashed: ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        case: c,
        passed: false,
        score: 0,
        failures: [`runner_crashed: ${err instanceof Error ? err.message : String(err)}`],
        durationMs: 0,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const totalTokens = results.reduce((s, r) => s + (r.tokens ?? 0), 0);
  const totalCostUsd = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const passRate = results.length > 0 ? results.filter((r) => r.passed).length / results.length : 0;
  const avgScore = results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0;

  const report: EvalReport = {
    runId,
    rubricSha,
    startedAt,
    finishedAt,
    cases: results,
    aggregate: {
      passRate,
      avgScore,
      totalTokens,
      totalCostUsd,
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
    },
  };

  console.error("");
  console.error(`▶ pass=${(passRate * 100).toFixed(0)}%  avg_score=${avgScore.toFixed(2)}  tokens=${totalTokens}  cost=$${totalCostUsd.toFixed(4)}`);

  if (!NO_WRITE && !DRY_RUN) {
    await writeEvalRows(report);
    console.error(`▶ wrote ${results.length} EvalRun rows`);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

async function rubricSignature(): Promise<string> {
  const src = readFileSync(resolve(__dirname, "../src/lib/rerank.ts"), "utf-8");
  const m = src.match(/const RERANK_RUBRIC = `([\s\S]*?)`/);
  return createHash("sha256").update(m?.[1] ?? "").digest("hex");
}

async function writeEvalRows(report: EvalReport) {
  await prisma.evalRun.createMany({
    data: report.cases.map((r) => ({
      runId: report.runId,
      caseName: r.case.name,
      query: r.case.query,
      score: r.score,
      passed: r.passed,
      failures: r.failures,
      durationMs: r.durationMs,
      tokens: r.tokens,
      costUsd: r.costUsd,
      rubric: report.rubricSha,
    })),
  });
}

main().catch((err) => {
  console.error("Runner crashed:", err);
  process.exit(2);
});
