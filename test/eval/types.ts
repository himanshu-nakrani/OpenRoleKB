export type SeniorityTarget = "junior" | "mid" | "senior" | "staff" | "principal";

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

  /**
   * Body-grounded skill check. For each item in top-N, the body must match
   * AT LEAST one alternative from EVERY group (groups AND, alternatives OR).
   * Example: anyOf: [["python","py"], ["airflow","mwaa","cloud composer"]]
   * means body must mention python AND (airflow|mwaa|cloud composer).
   */
  bodyMustMention?: {
    n: number;
    anyOf: string[][];
    /** Fraction of top-N that must satisfy. Default 0.6. */
    minHitRate?: number;
  };

  /** No body in any result may mention any of these terms. */
  bodyMustNotMention?: string[];

  /** Top-N body must contain a city synonym and/or remote signal. */
  locationMustGround?: {
    n?: number;             // default 5
    city?: string[];        // free-form: "bangalore", "hyderabad" — synonyms expanded
    remote?: boolean;       // when true, body must say remote/wfh/anywhere
    minHitRate?: number;    // default 0.6
  };

  /** Top-N body must mention seniority signal matching target. */
  seniorityMustGround?: {
    n?: number;             // default 5
    target: SeniorityTarget;
    minHitRate?: number;    // default 0.6
  };

  /** Reranker should return zero items (garbage / no-match queries). */
  expectNoResults?: boolean;

  /** No ATS marketing / report / blog / webinar URLs in the result set. */
  expectNoMetaPages?: boolean;

  /**
   * LLM-judge expectation. Skipped under --cheap.
   *  - minMeanRelevance: mean(overall.score) across top-N must be ≥ this
   *  - minPerItemRelevance: every item in top-N must score ≥ this (optional floor)
   */
  judge?: {
    n: number;
    minMeanRelevance: number;
    minPerItemRelevance?: number;
  };

  /**
   * Determinism check: run the same case `runs` times sequentially.
   * Top-N result IDs (post-rerank, post-filter) must be IDENTICAL each run.
   * Catches cache races, rerank flakiness, or any nondeterminism the user
   * would experience as "the ranking changes when I refresh".
   */
  stableTopN?: {
    n: number;
    runs: number;
  };
}

export interface GoldenCase {
  name: string;
  query: string;
  expectations: GoldenExpectation;
}

export interface DimensionResult {
  name: string;           // e.g. "body.skills_grounded"
  passed: boolean;
  hitRate?: number;       // n_passing / n_checked
  detail?: string;        // short human-readable summary
  offenders?: string[];   // up to ~3 sample failing items
}

export interface CaseResult {
  case: GoldenCase;
  passed: boolean;
  score: number;          // 0..1 — quality score across expectations.
  failures: string[];     // human-readable reasons.
  dimensions?: DimensionResult[];
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
