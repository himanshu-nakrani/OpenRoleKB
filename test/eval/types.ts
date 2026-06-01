export interface GoldenExpectation {
  /** "If I look at the top N, this many properties must hold." */
  topNMustMatch?: {
    n: number;
    minScore: number;
    /** ANY one of these patterns must appear in the title (case-insensitive). */
    titleContainsAny: string[];
  };
  /** Companies that must NOT appear in any result. */
  mustExcludeCompanies?: string[];
  /** Keyword patterns that must NOT appear in any returned title. */
  mustExcludeKeywordsInTitle?: string[];
  /** The single best result must score at least this. */
  topResultMinScore?: number;
  /** No senior/staff/principal in the top results. */
  noSeniorRoles?: boolean;
}

export interface GoldenCase {
  name: string;
  query: string;
  expectations: GoldenExpectation;
}

export interface CaseResult {
  case: GoldenCase;
  passed: boolean;
  score: number;          // 0..1 — quality score across expectations.
  failures: string[];     // human-readable reasons.
  durationMs: number;
  tokens?: number;
  costUsd?: number;
}

export interface EvalReport {
  runId: string;
  rubricSha: string;      // sha256 of RERANK_RUBRIC content at run time.
  startedAt: string;
  finishedAt: string;
  cases: CaseResult[];
  aggregate: {
    passRate: number;
    avgScore: number;
    totalTokens: number;
    totalCostUsd: number;
    totalDurationMs: number;
  };
}
