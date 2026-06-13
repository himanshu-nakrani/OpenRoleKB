import type { ExaResult } from "@/types/job";

export type RejectionReason =
  | "denylist_path"
  | "denylist_title"
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

// Locale path prefix pattern: strips leading /<2-letter-lang>(-<2-letter-region>)?/
// from URLs so that /de/about-us/ and /about-us/ both match the same denylist entries.
// Examples stripped: /de/, /en-us/, /fr-ca/
export const LOCALE_PREFIX_RE = /^\/[a-z]{2}(-[a-zA-Z]{2})?\//;

/**
 * Strip a locale prefix from a URL path so locale-mirrored pages collapse
 * to the same canonical path before denylist matching and URL dedup.
 * "/de/about-us/x" → "/about-us/x", "/en-us/careers/foo" → "/careers/foo"
 */
export function stripLocalePrefix(path: string): string {
  return path.replace(LOCALE_PREFIX_RE, "/");
}

// Path fragments that strongly indicate non-job content on ATS hosts.
// Conservative: only fragments observed in the 2026-06-06 quality audit
// (Ashby blog/resources/team/podcast/customers, Workable template generator)
// and the 2026-06-12 audit (leadership, author, integrations, press, events,
// webinars, expired postings, vendor-own careers category pages).
const DENY_PATH_FRAGMENTS = [
  "/blog/",
  "/resources/",
  "/customers/",
  "/customer-stories/",
  "/podcast/",
  "/team/",
  "/about/",
  "/about-us/",
  "/leadership/",
  "/product-updates/",
  "/post-jobs-for-free/",
  "/job-description/",
  "/job-descriptions/",
  "/templates/",
  "/template/",
  // Editorial / marketing channels
  "/author/",
  "/press/",
  "/news/",
  "/events/",
  "/webinars/",
  "/integrations/",
  "/partners/",
  "/case-stud",  // matches /case-studies/, /case-study/
];

// BambooHR and Lever vendor-own careers pages are category/index pages, not
// individual postings. Real bamboohr tenant postings live on <tenant>.bamboohr.com
// (already covered by ATS_JOB_URL_PATTERNS), not on bamboohr.com/careers/.
// Similarly lever.co/careers/ is the vendor's own hiring page, not a customer job.
const VENDOR_CAREERS_INDEX: Array<{ host: string; pathPrefix: string }> = [
  { host: "www.bamboohr.com", pathPrefix: "/careers" },
  { host: "bamboohr.com", pathPrefix: "/careers" },
  { host: "www.lever.co", pathPrefix: "/careers" },
  { host: "lever.co", pathPrefix: "/careers" },
];

// Tokens that strongly suggest a posting title rather than an editorial/brand page.
// We check for at least one of these before applying vendor-suffix title rejection
// to avoid false-positives on real postings like "Software Engineer | SmartRecruiters".
const ROLE_TOKENS_RE =
  /engineer|developer|manager|designer|analyst|scientist|architect|lead|consultant|specialist|administrator|intern|director/i;

// Title patterns that indicate clearly non-posting pages.
// Rule 1: Vendor brand suffix with no role token — e.g. "Michał Nowak | SmartRecruiters"
//         is a leadership bio; "Software Engineer | SmartRecruiters" is a real posting.
// Rule 2: Author attribution pages from ATS-vendor blogs.
// Rule 3: Expired or closed job notices (not worth surfacing).
const DENY_TITLE_RULES: Array<{ pattern: RegExp; requiresNoRoleToken?: boolean; reason: string }> = [
  {
    // Vendor-brand suffix (pipe-separated) with no job-role context.
    // Conservative: only reject when title has NO role token — preserves real postings.
    pattern: /\|\s*(SmartRecruiters|Lever|BambooHR|Teamtailor|Greenhouse)\s*$/i,
    requiresNoRoleToken: true,
    reason: "vendor_brand_suffix_no_role",
  },
  {
    // "— Author at Lever", "Author at BambooHR", etc.
    pattern: /—?\s*Author at /i,
    requiresNoRoleToken: false,
    reason: "author_page",
  },
  {
    // Expired / closed job notices.
    pattern: /job ad has expired|no longer (accepting|available)/i,
    requiresNoRoleToken: false,
    reason: "expired_posting",
  },
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
  // Normalize locale prefix before matching so /de/about-us/ and /about-us/
  // both match the same denylist entries.
  const path = stripLocalePrefix(url.pathname);

  if (DENY_PATH_FRAGMENTS.some((frag) => path.toLowerCase().includes(frag))) {
    return { urlClass: "marketing", isAtsHost: false };
  }

  // Reject vendor-own careers category/index pages (not customer job postings).
  if (VENDOR_CAREERS_INDEX.some((v) => host === v.host && path.startsWith(v.pathPrefix))) {
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

/**
 * Returns true if the title matches a denylist rule.
 * For vendor-suffix rules, also requires that no role-token appears in the title
 * (conservative: preserves real postings like "Software Engineer | SmartRecruiters").
 */
export function isTitleDenylisted(title: string | undefined): boolean {
  if (!title) return false;
  for (const rule of DENY_TITLE_RULES) {
    if (rule.pattern.test(title)) {
      if (rule.requiresNoRoleToken) {
        // Reject ONLY if there is no role-related token in the title.
        if (!ROLE_TOKENS_RE.test(title)) return true;
      } else {
        return true;
      }
    }
  }
  return false;
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
  if (isTitleDenylisted(r.title)) reasons.push("denylist_title");
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

// Drop hard-junk results (denylisted paths or titles). Keep ATS listing pages and
// unknown-host results — they may still be valid individual postings the
// classifier can't recognize, and the reranker will catch the rest.
export function filterResults(results: ExaResult[]): FilterReport {
  const counts: Record<RejectionReason | "kept", number> = {
    kept: 0,
    denylist_path: 0,
    denylist_title: 0,
    ats_url_not_individual_job: 0,
    no_signals: 0,
  };
  const kept: AssessedResult[] = [];
  const rejected: AssessedResult[] = [];
  for (const r of results) {
    const a = assessResult(r);
    if (
      a.quality.rejectionReasons.includes("denylist_path") ||
      a.quality.rejectionReasons.includes("denylist_title")
    ) {
      rejected.push(a);
      if (a.quality.rejectionReasons.includes("denylist_path")) counts.denylist_path++;
      if (a.quality.rejectionReasons.includes("denylist_title")) counts.denylist_title++;
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
