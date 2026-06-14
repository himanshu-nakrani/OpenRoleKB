import type { ExaResult, RerankItem } from "@/types/job";
import type { CaseResult, DimensionResult, GoldenCase, SeniorityTarget } from "./types";
import { extractCompany } from "@/lib/company";
import { expandCitySynonyms } from "@/lib/city-synonyms";
import type { JudgeRow } from "./judge";

const SENIOR_RX = /\b(senior|staff|principal|lead|director|vp|head of)\b/i;

const SENIORITY_PATTERNS: Record<SeniorityTarget, RegExp> = {
  junior: /\b(jr\.?|junior|associate|entry[- ]level|new[- ]grad|graduate|intern|trainee|level\s*1|l1|i\b|0[-\s]?[12]\s*(?:years?|yrs?))\b/i,
  mid: /\b(mid[- ]level|ii\b|level\s*2|l2|2[-\s]?[345]\s*(?:years?|yrs?)|3\+\s*(?:years?|yrs?))\b/i,
  senior: /\b(sr\.?|senior|iii\b|level\s*3|l3|5\+\s*(?:years?|yrs?)|6\+\s*(?:years?|yrs?)|7\+\s*(?:years?|yrs?))\b/i,
  staff: /\b(staff|iv\b|level\s*4|l4|8\+\s*(?:years?|yrs?)|10\+\s*(?:years?|yrs?))\b/i,
  principal: /\b(principal|distinguished|fellow|level\s*5|l5|10\+\s*(?:years?|yrs?)|12\+\s*(?:years?|yrs?))\b/i,
};

const REMOTE_RX = /\b(remote|work[- ]from[- ]home|wfh|anywhere|distributed|fully[- ]remote)\b/i;

// ATS marketing / non-job pages that occasionally leak past the live denylist.
const META_PAGE_RX =
  /(\/talent-trends|\/blog\/|\/blogs\/|\/webinar|\/on-demand\/|\/reports?\/|\/case-studies?\/|\/about(?:-us)?|\/leadership|\/contact|\/press)/i;

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bodyOf(r: ExaResult): string {
  return `${r.title ?? ""}\n${r.text ?? ""}\n${r.location ?? ""}`;
}

function rateOf(passing: number, checked: number): number {
  return checked === 0 ? 0 : passing / checked;
}

function shortLabel(r: ExaResult, maxLen = 70): string {
  const t = (r.title || r.url || "(untitled)").trim();
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

function pickWorstDim(j: JudgeRow): { name: string; score: number; evidence: string } {
  const dims: Array<{ name: string; score: number; evidence: string }> = [
    { name: "role", score: j.role_match.score, evidence: j.role_match.evidence },
    { name: "seniority", score: j.seniority_match.score, evidence: j.seniority_match.evidence },
    { name: "location", score: j.location_match.score, evidence: j.location_match.evidence },
    { name: "skills", score: j.skills_match.score, evidence: j.skills_match.evidence },
    { name: "exclusions", score: j.exclusions_clean.score, evidence: j.exclusions_clean.evidence },
  ];
  return dims.reduce((min, d) => (d.score < min.score ? d : min), dims[0]);
}

export interface ScoreOptions {
  /** When true, skip checks that depend on real rerank ordering. */
  cheap?: boolean;
}

export function scoreCase(
  c: GoldenCase,
  exaResults: ExaResult[],
  reranked: RerankItem[],
  durationMs: number,
  tokens?: number,
  costUsd?: number,
  judgeRows?: JudgeRow[],
  opts: ScoreOptions = {},
): CaseResult {
  const failures: string[] = [];
  const dimensions: DimensionResult[] = [];

  const rows = reranked
    .map((r) => ({ ...r, result: exaResults[r.idx] }))
    .filter((r) => r.result !== undefined);

  const exp = c.expectations;

  const record = (d: DimensionResult) => {
    dimensions.push(d);
    if (!d.passed) failures.push(`${d.name}: ${d.detail ?? "failed"}`);
  };

  // In --cheap, rerank is synthetic (0.8/0.4 split, no ordering) so checks
  // that read top-N of the *reranked* slice would be meaningless. Skip them
  // and record the skip so the reporter is honest about coverage.
  const skipRerankDependent = (name: string, why: string) => {
    dimensions.push({ name, passed: true, detail: `skipped (${why})` });
  };
  const CHEAP_SKIP_REASON = "cheap: rerank is synthetic";

  // ── topNMustMatch ────────────────────────────────────────────────────
  if (exp.topNMustMatch && opts.cheap) {
    skipRerankDependent("title.topN", CHEAP_SKIP_REASON);
  } else if (exp.topNMustMatch) {
    const { n, minScore, titleContainsAny } = exp.topNMustMatch;
    const slice = rows.slice(0, n);
    const titleRxs = titleContainsAny.map((p) => new RegExp(p, "i"));
    const matched = slice.filter(
      (r) => r.score >= minScore && titleRxs.some((rx) => rx.test(r.result.title ?? "")),
    );
    const threshold = Math.max(1, Math.floor(n / 2));
    record({
      name: "title.topN",
      passed: matched.length >= threshold,
      hitRate: rateOf(matched.length, slice.length),
      detail: `${matched.length}/${slice.length} top-${n} matched (need ≥${threshold}, score≥${minScore})`,
      offenders: slice
        .filter((r) => !matched.includes(r))
        .slice(0, 3)
        .map((r) => `${shortLabel(r.result)} (score=${r.score.toFixed(2)})`),
    });
  }

  // ── topResultMinScore ────────────────────────────────────────────────
  if (exp.topResultMinScore !== undefined && opts.cheap) {
    skipRerankDependent("rerank.topScore", CHEAP_SKIP_REASON);
  } else if (exp.topResultMinScore !== undefined) {
    const top = rows[0];
    const ok = !!top && top.score >= exp.topResultMinScore;
    record({
      name: "rerank.topScore",
      passed: ok,
      detail: `top=${top?.score?.toFixed(2) ?? "(none)"} need≥${exp.topResultMinScore}`,
    });
  }

  // ── mustExcludeCompanies ─────────────────────────────────────────────
  if (exp.mustExcludeCompanies?.length) {
    const banned = new Set(exp.mustExcludeCompanies.map((c) => c.toLowerCase()));
    const offenders = rows
      .map((r) => ({ row: r, company: extractCompany(r.result.url)?.toLowerCase() }))
      .filter((x) => x.company && banned.has(x.company));
    record({
      name: "exclusions.byCompany",
      passed: offenders.length === 0,
      detail: offenders.length === 0 ? "clean" : `${offenders.length} banned`,
      offenders: offenders.slice(0, 3).map((o) => `${o.company}: ${shortLabel(o.row.result)}`),
    });
  }

  // ── mustExcludeKeywordsInTitle ───────────────────────────────────────
  if (exp.mustExcludeKeywordsInTitle?.length) {
    const banned = exp.mustExcludeKeywordsInTitle.map((p) => new RegExp(p, "i"));
    const offenders = rows.filter((r) => banned.some((rx) => rx.test(r.result.title ?? "")));
    record({
      name: "exclusions.byTitle",
      passed: offenders.length === 0,
      detail: offenders.length === 0 ? "clean" : `${offenders.length} hits`,
      offenders: offenders.slice(0, 3).map((r) => shortLabel(r.result)),
    });
  }

  // ── noSeniorRoles ────────────────────────────────────────────────────
  if (exp.noSeniorRoles && opts.cheap) {
    skipRerankDependent("title.noSenior", CHEAP_SKIP_REASON);
  } else if (exp.noSeniorRoles) {
    const top5 = rows.slice(0, 5);
    const senior = top5.filter((r) => SENIOR_RX.test(r.result.title ?? ""));
    record({
      name: "title.noSenior",
      passed: senior.length <= 1,
      hitRate: rateOf(top5.length - senior.length, top5.length),
      detail: `${senior.length} senior-titled in top 5`,
      offenders: senior.slice(0, 3).map((r) => shortLabel(r.result)),
    });
  }

  // ── bodyMustMention ──────────────────────────────────────────────────
  if (exp.bodyMustMention && opts.cheap) {
    skipRerankDependent("body.skillsGrounded", CHEAP_SKIP_REASON);
  } else if (exp.bodyMustMention) {
    const { n, anyOf, minHitRate = 0.6 } = exp.bodyMustMention;
    const slice = rows.slice(0, n);
    const groupRxs = anyOf.map((alts) => alts.map((a) => new RegExp(`\\b${escapeRx(a)}\\b`, "i")));
    const passing = slice.filter((r) => {
      const body = bodyOf(r.result);
      return groupRxs.every((alts) => alts.some((rx) => rx.test(body)));
    });
    const rate = rateOf(passing.length, slice.length);
    record({
      name: "body.skillsGrounded",
      passed: rate >= minHitRate && slice.length > 0,
      hitRate: rate,
      detail: `${passing.length}/${slice.length} mention all required skill groups (need ≥${(minHitRate * 100).toFixed(0)}%)`,
      offenders: slice
        .filter((r) => !passing.includes(r))
        .slice(0, 3)
        .map((r) => shortLabel(r.result)),
    });
  }

  // ── bodyMustNotMention ───────────────────────────────────────────────
  if (exp.bodyMustNotMention?.length) {
    const banned = exp.bodyMustNotMention.map((p) => new RegExp(`\\b${escapeRx(p)}\\b`, "i"));
    const offenders = rows.filter((r) => {
      const body = bodyOf(r.result);
      return banned.some((rx) => rx.test(body));
    });
    record({
      name: "body.exclusions",
      passed: offenders.length === 0,
      detail: offenders.length === 0 ? "clean" : `${offenders.length} hits in bodies`,
      offenders: offenders.slice(0, 3).map((r) => shortLabel(r.result)),
    });
  }

  // ── locationMustGround ───────────────────────────────────────────────
  if (exp.locationMustGround && opts.cheap) {
    skipRerankDependent("body.locationGrounded", CHEAP_SKIP_REASON);
  } else if (exp.locationMustGround) {
    const { n = 5, city, remote, minHitRate = 0.6 } = exp.locationMustGround;
    const slice = rows.slice(0, n);
    const cityRxs: RegExp[] = (city ?? []).flatMap((c) =>
      expandCitySynonyms(c).map((syn) => new RegExp(`\\b${escapeRx(syn)}\\b`, "i")),
    );
    const passing = slice.filter((r) => {
      const body = bodyOf(r.result);
      const cityOk = cityRxs.length === 0 || cityRxs.some((rx) => rx.test(body));
      const remoteOk = remote === undefined ? true : (remote ? REMOTE_RX.test(body) : true);
      return cityOk && remoteOk;
    });
    const rate = rateOf(passing.length, slice.length);
    record({
      name: "body.locationGrounded",
      passed: rate >= minHitRate && slice.length > 0,
      hitRate: rate,
      detail: `${passing.length}/${slice.length} bodies match location signal (need ≥${(minHitRate * 100).toFixed(0)}%)`,
      offenders: slice
        .filter((r) => !passing.includes(r))
        .slice(0, 3)
        .map((r) => shortLabel(r.result)),
    });
  }

  // ── seniorityMustGround ──────────────────────────────────────────────
  if (exp.seniorityMustGround && opts.cheap) {
    skipRerankDependent("body.seniorityGrounded", CHEAP_SKIP_REASON);
  } else if (exp.seniorityMustGround) {
    const { n = 5, target, minHitRate = 0.6 } = exp.seniorityMustGround;
    const rx = SENIORITY_PATTERNS[target];
    const slice = rows.slice(0, n);
    const passing = slice.filter((r) => rx.test(bodyOf(r.result)));
    const rate = rateOf(passing.length, slice.length);
    record({
      name: "body.seniorityGrounded",
      passed: rate >= minHitRate && slice.length > 0,
      hitRate: rate,
      detail: `${passing.length}/${slice.length} bodies show "${target}" signal (need ≥${(minHitRate * 100).toFixed(0)}%)`,
      offenders: slice
        .filter((r) => !passing.includes(r))
        .slice(0, 3)
        .map((r) => shortLabel(r.result)),
    });
  }

  // ── expectNoResults ──────────────────────────────────────────────────
  if (exp.expectNoResults) {
    record({
      name: "system.noResults",
      passed: rows.length === 0,
      detail: rows.length === 0 ? "rerank empty" : `${rows.length} results returned`,
      offenders: rows.slice(0, 3).map((r) => shortLabel(r.result)),
    });
  }

  // ── expectNoMetaPages ────────────────────────────────────────────────
  if (exp.expectNoMetaPages) {
    const offenders = exaResults.filter((r) => META_PAGE_RX.test(r.url ?? ""));
    record({
      name: "system.noMetaPages",
      passed: offenders.length === 0,
      detail: offenders.length === 0 ? "clean" : `${offenders.length} marketing/meta URLs`,
      offenders: offenders.slice(0, 3).map((r) => shortLabel(r)),
    });
  }

  // ── judge (LLM) ──────────────────────────────────────────────────────
  if (exp.judge && judgeRows && judgeRows.length > 0) {
    const { n, minMeanRelevance, minPerItemRelevance } = exp.judge;
    const slice = judgeRows.slice(0, n);
    const overalls = slice.map((j) => j.overall.score);
    const mean = overalls.reduce((s, x) => s + x, 0) / overalls.length;
    const min = Math.min(...overalls);

    const meanOk = mean >= minMeanRelevance;
    const idxByMean = slice
      .filter((j) => j.overall.score < minMeanRelevance)
      .slice(0, 3)
      .map((j) => {
        const item = exaResults[j.idx];
        return `${shortLabel(item)} — overall=${j.overall.score.toFixed(2)} (${j.overall.why.slice(0, 60)})`;
      });
    record({
      name: "judge.meanRelevance",
      passed: meanOk,
      hitRate: mean,
      detail: `mean=${mean.toFixed(2)} across top-${slice.length} (need ≥${minMeanRelevance})`,
      offenders: idxByMean,
    });

    if (minPerItemRelevance !== undefined) {
      const floorOk = min >= minPerItemRelevance;
      const floorOffenders = slice
        .filter((j) => j.overall.score < minPerItemRelevance)
        .slice(0, 3)
        .map((j) => {
          const item = exaResults[j.idx];
          const worst = pickWorstDim(j);
          return `${shortLabel(item)} — ${worst.name}=${worst.score.toFixed(2)} "${worst.evidence.slice(0, 60)}"`;
        });
      record({
        name: "judge.minPerItem",
        passed: floorOk,
        detail: `min=${min.toFixed(2)} (need ≥${minPerItemRelevance})`,
        offenders: floorOffenders,
      });
    }
  } else if (exp.judge && (!judgeRows || judgeRows.length === 0)) {
    // Judge requested but skipped (e.g. --cheap). Mark as a non-failing
    // informational dimension so the reporter shows it but pass-rate isn't penalized.
    dimensions.push({
      name: "judge.skipped",
      passed: true,
      detail: "judge skipped (cheap mode or no rerank results)",
    });
  }

  const checks = dimensions.length;
  const passed = dimensions.filter((d) => d.passed).length;
  const score = checks === 0 ? 1 : passed / checks;
  return {
    case: c,
    passed: failures.length === 0,
    score,
    failures,
    dimensions,
    durationMs,
    tokens,
    costUsd,
  };
}
