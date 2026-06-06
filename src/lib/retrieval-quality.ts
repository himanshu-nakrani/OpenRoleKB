import type { ExaResult } from "@/types/job";

export type RejectionReason =
  | "denylist_path"
  | "ats_url_not_individual_job"
  | "no_signals";

export type UrlClass =
  | "individual_job"
  | "company_careers_listing"
  | "marketing"
  | "unknown";

export interface RetrievalQuality {
  urlClass: UrlClass;
  hasJobPostingSchema: boolean;
  rejectionReasons: RejectionReason[];
}

// Path fragments that strongly indicate non-job content on ATS hosts.
// Conservative: only fragments observed in the 2026-06-06 quality audit
// (Ashby blog/resources/team/podcast/customers, Workable template generator).
const DENY_PATH_FRAGMENTS = [
  "/blog/",
  "/resources/",
  "/customers/",
  "/customer-stories/",
  "/podcast/",
  "/team/",
  "/about/",
  "/product-updates/",
  "/post-jobs-for-free/",
  "/job-description/",
  "/job-descriptions/",
  "/templates/",
  "/template/",
];

// Hostnames where a path matching the allow pattern is a real job posting.
// Anything *outside* these allow patterns on these hosts is treated as
// uncertain (kept, but not promoted), not auto-rejected.
const ATS_JOB_URL_PATTERNS: Array<{
  hostMatch: (host: string) => boolean;
  pathPattern: RegExp;
  ats: string;
}> = [
  {
    ats: "greenhouse",
    hostMatch: (h) => h === "boards.greenhouse.io" || h.endsWith(".greenhouse.io"),
    // boards.greenhouse.io/{company}/jobs/{id}
    pathPattern: /^\/[^/]+\/jobs\/\d+/,
  },
  {
    ats: "lever",
    hostMatch: (h) => h === "jobs.lever.co",
    // jobs.lever.co/{company}/{uuid}
    pathPattern: /^\/[^/]+\/[0-9a-f-]{8,}/i,
  },
  {
    ats: "ashby",
    hostMatch: (h) => h === "jobs.ashbyhq.com",
    // jobs.ashbyhq.com/{company}/{uuid-or-slug}
    pathPattern: /^\/[^/]+\/[^/]+/,
  },
  {
    ats: "workable",
    hostMatch: (h) => h === "apply.workable.com",
    // apply.workable.com/{company}/j/{id}
    pathPattern: /^\/[^/]+\/j\//,
  },
  {
    ats: "smartrecruiters",
    hostMatch: (h) => h === "jobs.smartrecruiters.com",
    pathPattern: /^\/[^/]+\/\d+/,
  },
  {
    ats: "workday",
    hostMatch: (h) => h.endsWith(".myworkdayjobs.com"),
    pathPattern: /\/job\//,
  },
  {
    ats: "bamboohr",
    hostMatch: (h) => h.endsWith(".bamboohr.com"),
    pathPattern: /\/careers\/\d+/,
  },
  {
    ats: "recruitee",
    hostMatch: (h) => h.endsWith(".recruitee.com"),
    pathPattern: /\/o\//,
  },
  {
    ats: "teamtailor",
    hostMatch: (h) => h.endsWith(".teamtailor.com"),
    pathPattern: /\/jobs\//,
  },
  {
    ats: "personio",
    hostMatch: (h) => h.endsWith(".jobs.personio.de") || h === "jobs.personio.de",
    pathPattern: /\/job\//,
  },
];

function classifyUrl(rawUrl: string): { urlClass: UrlClass; isAtsHost: boolean } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { urlClass: "unknown", isAtsHost: false };
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (DENY_PATH_FRAGMENTS.some((frag) => path.toLowerCase().includes(frag))) {
    return { urlClass: "marketing", isAtsHost: false };
  }

  const atsPattern = ATS_JOB_URL_PATTERNS.find((p) => p.hostMatch(host));
  if (atsPattern) {
    if (atsPattern.pathPattern.test(path)) {
      return { urlClass: "individual_job", isAtsHost: true };
    }
    // On an ATS host but not matching an individual-job path. Likely a
    // board landing page (e.g. /companies) or a company root.
    return { urlClass: "company_careers_listing", isAtsHost: true };
  }

  return { urlClass: "unknown", isAtsHost: false };
}

// Permissive JSON-LD JobPosting detector. We don't need a full parser — we
// just need to know whether the page declares itself as a JobPosting per
// Google's structured-data requirements. False positives here are fine:
// a real reranker still scores semantic fit.
const JOBPOSTING_SCHEMA_HINTS = [
  /"@type"\s*:\s*"JobPosting"/i,
  /"@type"\s*:\s*\[[^\]]*"JobPosting"/i,
  /itemtype=["']https?:\/\/schema\.org\/JobPosting["']/i,
];

export function hasJobPostingSchema(text: string | undefined): boolean {
  if (!text) return false;
  return JOBPOSTING_SCHEMA_HINTS.some((rx) => rx.test(text));
}

export interface AssessedResult extends ExaResult {
  quality: RetrievalQuality;
}

export function assessResult(r: ExaResult): AssessedResult {
  const { urlClass } = classifyUrl(r.url);
  const schema = hasJobPostingSchema(r.text);
  const reasons: RejectionReason[] = [];
  if (urlClass === "marketing") reasons.push("denylist_path");
  if (urlClass === "company_careers_listing") reasons.push("ats_url_not_individual_job");
  return {
    ...r,
    quality: {
      urlClass,
      hasJobPostingSchema: schema,
      rejectionReasons: reasons,
    },
  };
}

export interface FilterReport {
  kept: AssessedResult[];
  rejected: AssessedResult[];
  counts: Record<RejectionReason | "kept", number>;
}

// Drop hard-junk results (denylisted paths). Keep ATS listing pages and
// unknown-host results — they may still be valid individual postings the
// classifier can't recognize, and the reranker will catch the rest.
export function filterResults(results: ExaResult[]): FilterReport {
  const counts: Record<RejectionReason | "kept", number> = {
    kept: 0,
    denylist_path: 0,
    ats_url_not_individual_job: 0,
    no_signals: 0,
  };
  const kept: AssessedResult[] = [];
  const rejected: AssessedResult[] = [];
  for (const r of results) {
    const a = assessResult(r);
    if (a.quality.rejectionReasons.includes("denylist_path")) {
      rejected.push(a);
      counts.denylist_path++;
      continue;
    }
    kept.push(a);
    counts.kept++;
    if (a.quality.rejectionReasons.includes("ats_url_not_individual_job")) {
      counts.ats_url_not_individual_job++;
    }
  }
  return { kept, rejected, counts };
}
