#!/usr/bin/env -S npx tsx
/**
 * Search-quality eval runner.
 *
 * Usage:
 *   npx tsx scripts/eval.ts                     # uses Exa snapshots, real Gemini
 *   npx tsx scripts/eval.ts --refresh-snapshots # re-fetches Exa for every case
 *   npx tsx scripts/eval.ts --case <name>       # run a single case
 *   npx tsx scripts/eval.ts --dry-run           # parse + score against synthetic rerank; no API calls
 *   npx tsx scripts/eval.ts --cheap             # deterministic checks only; skips rerank+judge; $0
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
import { searchLocalJobs } from "@/lib/local-search";
import { rerankWithMetrics } from "@/lib/rerank";
import { filterResults } from "@/lib/retrieval-quality";
import { LAYER_A_FALLBACK_THRESHOLD, LOCAL_SEARCH_MAX_RESULTS } from "@/lib/config";
import { dedupeSearchResults, applySeniorityFilter, applyExclusionFilter } from "@/app/api/search/route";
import { prisma } from "@/lib/prisma";
import { hasSnapshot, loadSnapshot, writeSnapshot } from "../test/eval/snapshot-cache";
import { scoreCase } from "../test/eval/score";
import { judge, type JudgeRow } from "../test/eval/judge";
import type { GoldenCase, CaseResult, EvalReport, DimensionResult } from "../test/eval/types";
import type { ExaResult, Filters, RerankItem } from "@/types/job";

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
const CHEAP = flag("--cheap");

const GEMINI_USD_PER_1K_TOKENS = 0.0014;

async function exaForCase(c: GoldenCase, filters: Filters): Promise<ExaResult[]> {
  if (DRY_RUN || (!REFRESH && hasSnapshot(c.query))) {
    // Re-apply current quality filter to snapshots — denylist evolves and a
    // stale snapshot must not bypass production filtering.
    return filterResults(loadSnapshot(c.query)).kept;
  }
  console.error(`  [exa] fetching live for "${c.query}"`);
  const results = await searchJobs(c.query, filters);
  writeSnapshot(c.query, results);
  return results;
}

async function candidatesForCase(c: GoldenCase): Promise<ExaResult[]> {
  const parsed = await parseQuery(c.query);
  const local = await searchLocalJobs(parsed.filters, LOCAL_SEARCH_MAX_RESULTS);
  const localResults = dedupeSearchResults(local.results);
  if (localResults.length >= LAYER_A_FALLBACK_THRESHOLD) return localResults;

  const exa = await exaForCase(c, parsed.filters);
  return dedupeSearchResults([...localResults, ...exa]);
}

function syntheticRerank(exa: ExaResult[]): { items: RerankItem[]; tokens?: number } {
  // Deterministic synthetic: top half scored 0.8, bottom half 0.4. Used in --dry-run
  // so the harness itself can be tested without paying for Gemini.
  const items = exa.map((_, idx) => ({
    idx,
    score: idx < exa.length / 2 ? 0.8 : 0.4,
    fit: `synthetic-rank-${idx}`,
  }));
  return { items, tokens: 0 };
}

interface SingleRunOutput {
  exa: ExaResult[];
  items: RerankItem[];
  rerankTokens?: number;
}

async function executeOnce(c: GoldenCase): Promise<SingleRunOutput> {
  const parsed = await parseQuery(c.query);
  const exa = await candidatesForCase(c);
  const r = DRY_RUN || CHEAP
    ? syntheticRerank(exa)
    : await rerankWithMetrics(c.query, exa);
  let items = r.items;
  items = applySeniorityFilter(items, exa, parsed.filters);
  items = applyExclusionFilter(items, exa, parsed.filters);
  return { exa, items, rerankTokens: r.tokens };
}

async function runCase(c: GoldenCase): Promise<CaseResult> {
  const t0 = Date.now();
  const first = await executeOnce(c);
  let { exa, items, rerankTokens } = first;

  // Stability check: re-execute and compare top-N IDs against the first run.
  let stableDim: DimensionResult | undefined;
  if (c.expectations.stableTopN) {
    const { n, runs } = c.expectations.stableTopN;
    const baselineIds = first.items.slice(0, n).map((it) => first.exa[it.idx]?.id ?? `idx:${it.idx}`);
    const mismatches: string[] = [];
    for (let i = 1; i < runs; i++) {
      const next = await executeOnce(c);
      rerankTokens = (rerankTokens ?? 0) + (next.rerankTokens ?? 0);
      const nextIds = next.items.slice(0, n).map((it) => next.exa[it.idx]?.id ?? `idx:${it.idx}`);
      const ok = baselineIds.length === nextIds.length && baselineIds.every((id, k) => id === nextIds[k]);
      if (!ok) mismatches.push(`run ${i + 1}: [${nextIds.slice(0, 3).join(", ")}] ≠ baseline [${baselineIds.slice(0, 3).join(", ")}]`);
    }
    stableDim = {
      name: "system.stableTopN",
      passed: mismatches.length === 0,
      detail: mismatches.length === 0
        ? `top-${n} identical across ${runs} runs`
        : `${mismatches.length}/${runs - 1} subsequent runs diverged`,
      offenders: mismatches.slice(0, 3),
    };
  }

  // LLM judge — independent rubric, runs only when the case requests it.
  let judgeRows: JudgeRow[] | undefined;
  let judgeTokens: number | undefined;
  if (!CHEAP && !DRY_RUN && c.expectations.judge && items.length > 0) {
    const n = c.expectations.judge.n;
    const top = items.slice(0, n).map((it) => ({ result: exa[it.idx], idx: it.idx }));
    const j = await judge(c.query, top);
    judgeRows = j.rows;
    judgeTokens = j.tokens;
  }

  const durationMs = Date.now() - t0;
  const tokens = (rerankTokens ?? 0) + (judgeTokens ?? 0);
  const costUsd = tokens > 0 ? (tokens / 1000) * GEMINI_USD_PER_1K_TOKENS : undefined;
  const cr = scoreCase(c, exa, items, durationMs, tokens, costUsd, judgeRows, { cheap: CHEAP });
  if (stableDim) {
    cr.dimensions = [...(cr.dimensions ?? []), stableDim];
    if (!stableDim.passed) {
      cr.passed = false;
      cr.failures.push(`${stableDim.name}: ${stableDim.detail}`);
      // Re-derive score with the new dimension included
      const total = cr.dimensions.length;
      const passing = cr.dimensions.filter((d) => d.passed).length;
      cr.score = total === 0 ? 1 : passing / total;
    }
  }
  return cr;
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

  const mode = CHEAP ? " [cheap]" : DRY_RUN ? " [dry-run]" : "";
  console.error(`▶ Eval run ${runId.slice(0, 8)} — ${cases.length} cases (rubric ${rubricSha.slice(0, 8)})${mode}`);

  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stderr.write(`  ${c.name} ... `);
    try {
      const r = await runCase(c);
      results.push(r);
      console.error(`${r.passed ? "✓" : "✗"} score=${r.score.toFixed(2)} ${r.durationMs}ms ${r.tokens != null ? `${r.tokens}tok` : ""}`);
      for (const d of r.dimensions ?? []) {
        const mark = d.passed ? "✓" : "✗";
        const rate = d.hitRate != null ? ` (${(d.hitRate * 100).toFixed(0)}%)` : "";
        console.error(`      ${mark} ${d.name}${rate} — ${d.detail ?? ""}`);
        if (!d.passed) {
          for (const o of d.offenders ?? []) console.error(`          · ${o}`);
        }
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

  if (!NO_WRITE && !DRY_RUN && !CHEAP) {
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
      dimensions: (r.dimensions ?? []) as object,
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
