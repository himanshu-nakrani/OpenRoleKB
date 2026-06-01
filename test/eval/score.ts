import type { ExaResult, RerankItem } from "@/types/job";
import type { CaseResult, GoldenCase } from "./types";
import { extractCompany } from "@/lib/company";

const SENIOR_RX = /\b(senior|staff|principal|lead|director|vp|head of)\b/i;

export function scoreCase(
  c: GoldenCase,
  exaResults: ExaResult[],
  reranked: RerankItem[],
  durationMs: number,
  tokens?: number,
  costUsd?: number,
): CaseResult {
  const failures: string[] = [];
  let checks = 0;
  let passed = 0;

  // Reranked rows are sorted highest-score first; map to ExaResult for inspection.
  const rows = reranked
    .map((r) => ({ ...r, result: exaResults[r.idx] }))
    .filter((r) => r.result !== undefined);

  const exp = c.expectations;

  // ── topNMustMatch ────────────────────────────────────────────────────
  if (exp.topNMustMatch) {
    const { n, minScore, titleContainsAny } = exp.topNMustMatch;
    const slice = rows.slice(0, n);
    const titleRxs = titleContainsAny.map((p) => new RegExp(p, "i"));
    const matchedCount = slice.filter(
      (r) => r.score >= minScore && titleRxs.some((rx) => rx.test(r.result.title)),
    ).length;
    checks++;
    // Pass if at least floor(n/2) of the top N match — we tolerate some noise.
    const threshold = Math.max(1, Math.floor(n / 2));
    if (matchedCount >= threshold) {
      passed++;
    } else {
      failures.push(
        `topNMustMatch: only ${matchedCount}/${n} of top-${n} results scored ≥${minScore} AND matched a title pattern (need ≥${threshold})`,
      );
    }
  }

  // ── topResultMinScore ────────────────────────────────────────────────
  if (exp.topResultMinScore !== undefined) {
    checks++;
    const top = rows[0];
    if (top && top.score >= exp.topResultMinScore) {
      passed++;
    } else {
      failures.push(
        `topResultMinScore: top result scored ${top?.score?.toFixed(2) ?? "(none)"} < ${exp.topResultMinScore}`,
      );
    }
  }

  // ── mustExcludeCompanies ─────────────────────────────────────────────
  if (exp.mustExcludeCompanies?.length) {
    checks++;
    const banned = new Set(exp.mustExcludeCompanies.map((c) => c.toLowerCase()));
    const offenders = rows
      .map((r) => extractCompany(r.result.url)?.toLowerCase())
      .filter((c): c is string => Boolean(c))
      .filter((c) => banned.has(c));
    if (offenders.length === 0) {
      passed++;
    } else {
      failures.push(`mustExcludeCompanies: banned companies appeared: ${[...new Set(offenders)].join(", ")}`);
    }
  }

  // ── mustExcludeKeywordsInTitle ───────────────────────────────────────
  if (exp.mustExcludeKeywordsInTitle?.length) {
    checks++;
    const banned = exp.mustExcludeKeywordsInTitle.map((p) => new RegExp(p, "i"));
    const offenders = rows.filter((r) => banned.some((rx) => rx.test(r.result.title)));
    if (offenders.length === 0) {
      passed++;
    } else {
      failures.push(
        `mustExcludeKeywordsInTitle: banned keywords appeared in: ${offenders.slice(0, 3).map((o) => o.result.title).join(" | ")}`,
      );
    }
  }

  // ── noSeniorRoles ────────────────────────────────────────────────────
  if (exp.noSeniorRoles) {
    checks++;
    const top5 = rows.slice(0, 5);
    const senior = top5.filter((r) => SENIOR_RX.test(r.result.title));
    if (senior.length <= 1) {
      passed++;
    } else {
      failures.push(`noSeniorRoles: ${senior.length} senior-titled roles in top 5`);
    }
  }

  const score = checks === 0 ? 1 : passed / checks;
  return {
    case: c,
    passed: failures.length === 0,
    score,
    failures,
    durationMs,
    tokens,
    costUsd,
  };
}
