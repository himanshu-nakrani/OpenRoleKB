# OpenRoleKB — Implementation Review & Roadmap

Date: 2026-06-10. Based on code reading + live DB stats (4,140 jobs).

---

# PART 1 — REVIEW OF CURRENT IMPLEMENTATION

## 1a. Coverage analysis

Measured corpus reality (queried the live DB, not the README):

| Metric | Value |
|---|---|
| Total jobs | 4,140 |
| Greenhouse share | 3,972 (96%) |
| Distinct companies | **40** |
| India-located (incl. city regex: Bengaluru/Hyderabad/Pune/etc.) | **171 (4.1%)** |
| isRemote = true | 950 (23%) |
| Top locations | SF, Dublin, NYC, London, Tokyo |

The corpus is, bluntly, "40 mostly-US Greenhouse companies." The Workday ~8.3k jobs
mentioned in planning either aren't in this DB or were purged; what's actually here
is Greenhouse-dominated.

**Coverage vs. findable jobs, by priority:**

| Priority | Findable universe (public, legal) | Corpus today | Coverage |
|---|---|---|---|
| 1. India | ~150–300k active tech openings (Naukri alone lists ~400k+; dedup to maybe 150k real) | 171 | **~0.1%** |
| 2. Remote | ~30–60k active remote-tech posts across dedicated boards + ATS | ~950 | **~2%** |
| 3. US/global | ~300–500k active US tech openings | ~3k | **~0.7–1%** |

Where each adapter wins/loses:

- **Greenhouse/Lever/Ashby/SmartRecruiters (slug-based)** — wins: clean JSON, free,
  reliable, full descriptions. Loses: coverage is bounded by *your slug list*, and
  these ATSs skew VC-funded US/EU startups. Indian companies overwhelmingly use
  Darwinbox/Keka/Zoho Recruit/Naukri RMS — so this channel structurally cannot
  reach most of Priority 1. The 9 Indian Greenhouse slugs are mostly GCCs and
  India offices of US startups — good jobs, tiny slice.
- **Workday** — wins: enterprise + GCC India offices (huge Indian employers like
  Deloitte, JPMC India run Workday). Loses: Cloudflare/SSO walls on the biggest
  tenants; only 7 tenants working; fragile session handshake.
- **Adzuna** — the single highest-leverage *blocked* item. Adzuna India aggregates
  a meaningful chunk of the Indian market (including Naukri-syndicated posts, i.e.
  Naukri inventory *without* scraping Naukri). 250 calls/mo free is enough for
  ~12k jobs/mo at 50/page. Currently dead for want of two env vars.
- **JSON-LD crawler** — wins: reaches companies on no standard ATS (Zoho, Zerodha).
  Loses: 12 seeds, two-level crawl is slow, most modern SPAs render JSON-LD
  client-side so it misses them. Doesn't scale past curated seeds.
- **Exa (Layer B)** — wins: long-tail discovery, real-time. Loses: `includeDomains`
  restricted to 10 ATS domains *and* `userLocation: "US"` is hardcoded —
  Layer B is structurally biased against Priority 1. It also returns ATS
  marketing/meta pages because neural similarity ≠ "is a job posting."

## 1b. Quality diagnosis — the Hyderabad query, ranked by impact

Query: "ai engineer role in hyderabad for 3 years of experience"

**#1 — Reranker ties at 0.50 (root cause: output-token truncation).**
`rerank.ts` sends up to 50 results and caps `max_tokens: 2000`. Each scored item
(`{idx, score, fit}` with an 80-char fit string) costs ~30–45 output tokens →
50 items need ~1,800–2,250 tokens. The JSON tool-call gets truncated mid-array,
`JSON.parse` throws, and the route-level fallback assigns 0.5 + empty fit to
everything. This exactly matches the observed symptom (uniform 0.50, empty fit
strings). It silently destroys ranking on *every* full-size result set, not just
this query. One-line fix candidates: raise max_tokens to ~4000, drop `fit` to
20 chars, or score in batches of 15.

**#2 — Parser returned role = raw string (root cause: LLM call failed, and the
failure is invisible).** The fast-path regex doesn't apply here (10 words > 5),
so the LLM was called and threw or timed out (4s abort), landing in the catch:
`filters = { role: rawQuery }`. Two compounding issues: (a) the tool schema has
**no years-of-experience field at all** — even a successful parse discards
"3 years"; (b) `parseError` is returned but apparently not surfaced loudly enough
to alert you that parsing failed. A failed parse should degrade to keyword
extraction, not "whole query becomes the role."

**#3 — Layer A 0 hits (root cause: AND-semantics over a garbage role string +
location never filtered).** With role = the entire raw query, `buildTsQuery`
produces `ai & engineer & role & in & hyderabad & for & years & of & experience`
— no job description contains all of those as stemmed terms; 0 hits is
guaranteed. Worse: even with a correct parse, **`local-search.ts` never filters
by location**. The comment says "Location and remote are post-filtered below,"
but the code only post-filters `remote`. A correctly-parsed
`location: "Hyderabad"` is silently dropped, so Layer A can't do
location-constrained search *at all*. The 602 Indian Greenhouse jobs were
unreachable twice over.

**#4 — Layer B junk (root cause: neural similarity + weak URL classification).**
`buildQueryString` appended "job posting hiring" to a query that was already the
raw string, and Exa matched pages *about* hiring on ATS domains (SmartRecruiters
leadership bios, Lever blog authors). The denylist is deliberately conservative
and `retrieval-quality.ts` keeps "unknown" URL classes, trusting the reranker to
sort them — but the reranker was dead (#1), so junk sailed through unranked.
Also `userLocation: "US"` actively hurt a Hyderabad query.

**#5 — Duplicates (root cause: no content-level dedup).** Jobs are upserted by
URL; the same posting appears under multiple URLs (location-variant pages, Exa
result vs. ingested row) and there's no (company, title-normalized, location)
content hash at *query* time, only in the Adzuna ingester.

The systemic lesson: each layer assumes the previous one worked. Parser failure →
absurd tsquery → 0 local hits → Exa fires with a bad query → junk arrives →
reranker (the designated junk filter) silently fails → user sees noise. There is
no circuit breaker or degraded-mode behavior anywhere in the chain.

## 1c. Architectural risks at scale

**At 10x (~40k jobs):**
- **AND-FTS recall ceiling.** `term1 & term2 & ... & termN` already returns 0 on
  long queries; with a bigger, more heterogeneous corpus, the precision/recall
  tradeoff of strict AND gets worse, not better. You'll have thousands of relevant
  rows you can't retrieve. This is the first thing to break.
- **Rerank input cap.** 50 candidates into the LLM stays fixed while the corpus
  grows — the retrieval stage (FTS) becomes the quality bottleneck because the
  reranker never sees the good candidates.
- **Ingest freshness.** Full re-crawl of all slugs is fine at 40 companies; at
  400 it's an hour+ of sequential fetches and stale `lastSeenAt` starts marking
  live jobs dead. You'll need incremental sync + a queue (the ARCHITECTURE.md
  "no background jobs yet" decision expires here).
- **Dedup pressure.** Adding any aggregator (Adzuna) alongside direct ATS feeds
  guarantees the same job from two sources. Without canonical-URL inference +
  content hashing, duplicates grow superlinearly with source count.

**At 100x (~400k jobs):**
- Postgres FTS itself is fine (GIN index handles millions of rows), but
  `ts_rank` ordering without a covering index does a full scan of matches;
  latency degrades on broad queries.
- **SearchCache invalidation** — 6h TTL over a corpus that changes by thousands
  of jobs/day means cached results visibly miss new postings.
- **Bills:** Gemini stays cheap (~$0.0001/search is real). Exa at $0.005/req is
  the cost driver if Layer A recall stays bad (every thin Layer A result fires
  Exa). Fixing Layer A recall is also a cost optimization. Embedding 400k jobs
  once is ~$5–15 (cheap); the real cost is operational complexity.
- **Quality bottleneck order: retrieval recall → dedup → freshness → latency →
  $.** Money is last; recall is first.

---

# PART 2 — FUTURE IMPLEMENTATION OPTIONS

Legend: Effort S = a weekend, M = 1–2 weeks, L = a month, XL = don't (solo).

## Priority 0 (do first): fix the pipeline you have

Coverage work is wasted while the pipeline mangles queries. These are all S:

| Option | Gain | Effort | Risk | $ |
|---|---|---|---|---|
| Rerank truncation fix (batch scoring or max_tokens) | Every search; restores ranking | S | None | ~0 |
| Add yearsExperience + location post-filter to Layer A | Unlocks India queries against existing 602 jobs | S | None | 0 |
| Parser fallback: on LLM failure, regex-extract location/years instead of role=rawQuery | Resilience | S | None | 0 |
| Drop `userLocation:"US"` / make it parse-driven | India recall in Layer B | S | None | 0 |
| India golden queries in eval set (currently zero!) | Makes P1 regressions visible | S | None | 0 |

The eval harness has 10 golden queries and not one is India-focused. Your eval
set encodes the *inverse* of your priority order. Fix that first or you'll
optimize the wrong thing forever.

## Priority 1 — Indian market

| Option | Jobs gained | Effort | Risk | $/mo | Depends on |
|---|---|---|---|---|---|
| A. Adzuna unblock (free keys) + IN country feed | ~10–12k/mo crawlable at free tier | **S** | Low (TOS-clean API) | $0 | dedup |
| B. ATS slug-discovery engine (find every Indian Greenhouse/Lever/Ashby/SR tenant via Exa/Google dorks/sitemaps, auto-probe, auto-add) | est. 200–500 Indian tenants → 5–15k jobs | **M** | Low | ~$5 Exa | existing adapters |
| C. GCC sweep: Workday/SuccessFactors tenants of US firms' India offices (Walmart Labs, Target, Lowe's, airlines, banks) | 10–30k India jobs | M–L | Med (Cloudflare on some) | $0 | Workday adapter |
| D. Darwinbox/Keka/Zoho Recruit adapters — these expose per-tenant public career-site JSON (Keka: `/careers/api/...`, Zoho Recruit public widget API) | The domestic mid-market; 20–50k jobs if tenant discovery works | **L** | Med: undocumented APIs, per-tenant variance | $0 | slug-discovery engine (B) generalizes here |
| E. Cutshort / Instahyre / Hirect | Real inventory but all are TOS-protected marketplaces | M | **High legal-grey** | $0 | — |
| F. Naukri direct scrape | The whole market | L | **Lawsuit-grade. Do not.** Naukri (Info Edge) litigates. | — | — |
| G. Community submission flow + verification | Slow burn; 10s–100s/mo initially | M | Low; spam moderation cost | $0 | none |
| H. Indian govt/PSU (ISRO, BHEL, NIC) | Small, niche, high differentiation | S–M | Low (public notices) | $0 | none |

Sharp POV: **B is the compounding play.** You already own four working slug-based
adapters; their coverage is bounded only by slug lists. An automated tenant-discovery
pipeline (Exa query: `site:boards.greenhouse.io "Bengaluru"`, sitemap crawls,
crunchbase-style company lists) turns four adapters into a self-growing corpus, and
the same discovery engine is reusable for Darwinbox/Keka later (D). Adzuna (A) is
the cheapest legitimate path to Naukri-adjacent inventory — it's an aggregator
that licenses feeds, so you inherit Indian inventory without touching Naukri's TOS.
Skip E and F; revisit Cutshort only as a partnership conversation, not a scrape.

## Priority 2 — Remote

| Option | Jobs gained | Effort | Risk | $/mo | Depends on |
|---|---|---|---|---|---|
| I. Generic feed adapter: Remotive (public API), RemoteOK (public JSON), WWR (RSS), Himalayas (API), Working Nomads (RSS) | ~5–15k active remote jobs, refreshed daily | **S–M total** (one adapter, five configs) | Low — these *want* distribution; check attribution requirements | $0 | dedup |
| J. HN "Who is Hiring" monthly parser (LLM-structured extraction of comments) | ~500–800/mo, very high quality, many remote + India-friendly | **S** | Low | ~$1 LLM | none |
| K. YC Work at a Startup | ~2–4k jobs | M | Med (auth-walled API, grey) | $0 | — |
| L. Toptal/Turing/Andela boards | Marketplace listings, thin descriptions | M | Med-grey | $0 | — |

I + J are nearly free coverage and remote boards explicitly allow republication
(RemoteOK's JSON literally asks for a backlink). Do both early. Skip K/L initially.

## Priority 3 — Global / US

| Option | Jobs gained | Effort | Risk | $/mo | Depends on |
|---|---|---|---|---|---|
| M. Slug-discovery engine pointed at US/EU tenants (same as B) | 50–150k jobs | already built in B | Low | ~$5 | B |
| N. Workday + Playwright (FAANG/Indian IT unlock) | 50k+ jobs incl. Infosys/Wipro/TCS-adjacent | **L**, fragile forever (Cloudflare arms race) | Med-high operational | ~$10–30 (proxy/headless infra) | — |
| O. USAJobs API (documented, free, public) | ~5–10k federal tech | S | None | $0 | none |
| P. Adzuna US at paid tier | 100k+ | S | Low | **>$50 — flag; only after free tier proves conversion** | A |
| Q. iCIMS/Taleo/SuccessFactors per-tenant adapters | Enterprise long tail | L each | Med | $0 | discovery engine |

N is the classic trap for a solo operator: a month of Playwright work that breaks
weekly. Defer until B/M have exhausted the easy tenants. O is a weekend and a
nice "comprehensive" credential.

## Cross-cutting

| Option | Lift | Effort | Notes |
|---|---|---|---|
| R. pgvector hybrid retrieval (embed jobs at ingest, cosine + FTS union, rerank on top) | Fixes the AND-recall ceiling for ALL priorities | **M** | Embedding 40k jobs ≈ $1. The single biggest quality unlock after the P0 fixes. |
| S. Content-hash dedup + canonical URL inference at ingest *and* result-assembly | Required before any aggregator (A, I) lands | **S** | (companyNorm, titleNorm, locationNorm) hash + prefer ATS URL over aggregator URL |
| T. Location/role taxonomy: city synonyms (Bengaluru=Bangalore, Gurgaon=Gurugram), role aliases (SDE=Software Engineer, "member of technical staff") | Direct P1 win — Indian queries use Indian vocabulary | **S–M** | Static tables first; no ML needed |
| U. Log real queries → auto-grow golden set | Compounds eval forever | S | You already have EventLog; add a weekly triage script |
| V. Browser extension capture | Novel inventory incl. LinkedIn views (user-initiated, legally cleaner) | L | Cool but premature pre-traffic |
| W0. JobSpy-based coverage benchmark (NOT an ingest source) | Turns the coverage-% claims in this doc into weekly measurements | **S** | JobSpy (MIT, 3.6k★) scrapes Naukri/Indeed-IN/Glassdoor-IN/Bayt/BDJobs. Weekly offline script: scrape benchmark queries ("software engineer Bengaluru", …), diff against our corpus, report "% of board inventory we cover via legal channels." Data never ships to users → no republication exposure. Python; run as a cron script writing a report, not in the app. |

---

# RECOMMENDED 90-DAY ROADMAP

Five moves, sequenced. Theme: **fix retrieval → unblock free inventory →
build the discovery engine → make recall semantic → measure with India-first eval.**

**Move 1 (Week 1–2): Pipeline triage — the P0 table, all of it.**
Rerank batching/max_tokens fix, Layer A location post-filter, yearsExperience in
the parse schema, parser degraded-mode, parse-driven Exa userLocation, content-hash
dedup (S), and 5 India golden queries. Rationale: every later move is invisible
or wasted while ranking is broken and the eval can't see India. This is days of
work, not weeks, and it makes the existing 602 Indian jobs actually findable —
likely a bigger perceived-quality jump than any new adapter.

**Move 2 (Week 2–3): Free inventory unblocks — aggregator stack + remote feed adapter + HN parser.**
Get the Adzuna keys (it's a signup form) and turn on the IN feed within the
250-call budget. Then stack the other legal aggregators behind the same generic
feed adapter: Talent.com publisher XML, Careerjet affiliate API, Jooble partner
API (see W in the Max-India addendum). Ship Remotive/RemoteOK/WWR/Himalayas
configs and the HN Who-is-Hiring parser. Rationale: ~25k+ jobs for near-zero
ongoing cost, covering Priorities 1 and 2 simultaneously, all TOS-clean. Dedup
from Move 1 is the hard prerequisite — four aggregators without dedup is chaos.

**Move 3 (Week 3–6): ATS tenant-discovery engine + JSON-LD scale-up.**
Automate finding Greenhouse/Lever/Ashby/SmartRecruiters tenants (Exa +
Google dorks + probe), with an India-first seed strategy (search "Bengaluru",
"Hyderabad", "Pune" on ATS domains). Auto-add verified tenants to ingest configs.
**Shortcut (verified 2026-06-10):** OpenPostings ships its company dataset in-repo
— `jobs.db` (SQLite) with **61,610 companies** incl. **7,304 on our supported
ATSs** (Greenhouse 2,680 / Workday 4,621 / Ashby 1,444 / Lever ~238) plus 1,751
Zoho Recruit tenants and 2,389 iCIMS for later moves. Caveat: the repo has **NO
license** (all-rights-reserved by default). Path: (1) ask the maintainer for a
license/permission via GitHub issue; (2) failing that, regenerate the list
ourselves with their openly-described technique (search-engine dorks + subdomain
scans) — factual name+URL data is thin-copyright anyway, but regeneration is the
clean play and lets us seed India-first. Either way this collapses discovery
from "build an engine" to "probe and verify a known 7k-tenant list" and the
target rises from 300+ tenants to **3,000+**.
Rationale: this is the compounding asset — it converts four existing adapters
from "bounded by my curiosity" to "bounded by the ATS market," and it's the
template for Darwinbox/Keka later. In the same window, scale the JSON-LD crawler
using Web Data Commons / Common Crawl as a discovery seed (X in the addendum):
career pages that the tenant-probe rejects ("has a careers page, not on a known
ATS") become JSON-LD crawl targets instead of dead ends. Add the tiered fetcher
(X3): plain fetch first, self-hosted headless render (Firecrawl OSS/Playwright)
only for domains where plain fetch finds no JSON-LD — this unlocks SPA career
pages, the crawler's biggest blind spot.

**Move 4 (Week 6–9): pgvector hybrid retrieval.**
Embed at ingest, retrieve via FTS ∪ vector, rerank the union. Rationale: by now
the corpus is 5–10x bigger and AND-FTS is the binding constraint on quality;
embeddings fix "SDE II Hyderabad" matching "Software Development Engineer,
Bengaluru/Hyderabad" without taxonomy whack-a-mole. (Still ship the static
city-synonym table from T — it's an afternoon.)

**Move 5 (Week 9–12): Darwinbox/Keka/SuccessFactors reconnaissance + eval-driven hardening.**
Spike (timeboxed: 1 week) reverse-engineering Keka and Darwinbox public career-page
JSON for 10 sample tenants each, plus SAP SuccessFactors public career-site OData
(many large Indian enterprises and GCCs run it — one adapter unlocks dozens of
tenants). Reference material: OpenPostings' `server/ats/` directory contains
working adapter implementations for 80+ ATS providers (incl. Zoho, SAP, iCIMS,
Taleo, Oracle Cloud, Eightfold, Dayforce) — read for endpoint shapes and
pagination quirks even though the code can't be vendored (no license). The
OpenPostings dataset also provides ready target lists: 1,751 Zoho Recruit
tenants and 2,389 iCIMS tenants. If the per-tenant variance is manageable, build the adapter and point
the Move-3 discovery engine at it — that's the genuine "Indian mid-market"
unlock no aggregator gives you. In parallel, run the query-log-to-golden-set
loop (U) weekly and let real user queries drive the next quarter. If
Darwinbox/Keka turn out hostile, fall back to the GCC Workday tenant sweep (C)
instead.

**Deliberately deferred:** Workday+Playwright (fragile, month-scale, revisit when
discovery engine plateaus), Adzuna paid tier (> $50/mo — only after free tier
shows users clicking Adzuna-sourced jobs; with Talent.com + Careerjet stacked
you may never need it), browser extension (pre-traffic — but see Tier 5 below:
it is the only legal route to Naukri/LinkedIn exclusives, so it graduates to
the Q2 plan once there is real traffic), anything touching Naukri/LinkedIn/
Wellfound directly (legal risk exceeds a solo operator's appetite; the
aggregator stack gets you the syndicated slice legitimately).

Steady-state cost of the whole 90-day plan: roughly **$10–20/mo**
(Exa discovery queries + embeddings + Gemini), well inside budget.

---

# TARGET ARCHITECTURE (end-state after the 90-day plan + addendum)

High-level view of the expected app. Everything marked ▸new does not exist
today; everything else is an upgrade of a current component.

```
════════════════════════ INGESTION PLANE (offline, cron) ════════════════════════

  SOURCES                          DISCOVERY ▸new
  ┌─────────────────────────┐      ┌──────────────────────────────────────┐
  │ ATS adapters            │◀─────│ Tenant-discovery engine              │
  │  Greenhouse · Lever     │      │  OpenPostings list / Exa dorks /     │
  │  Ashby · SmartRecruiters│      │  sitemap+subdomain scans             │
  │  Workday                │      │  (India-first seeding)               │
  │  + Zoho Recruit ▸new    │      └──────────────┬───────────────────────┘
  │  + Keka/Darwinbox ▸new  │                     │ rejects: "careers page,
  │  + SuccessFactors ▸new  │                     │  no known ATS"
  ├─────────────────────────┤                     ▼
  │ Aggregator feeds ▸new   │      ┌──────────────────────────────────────┐
  │  Adzuna IN · Talent.com │      │ JSON-LD crawler (scaled)             │
  │  Careerjet · Jooble     │      │  seeds: WDC/Common Crawl + rejects   │
  ├─────────────────────────┤      │  TIERED FETCHER ▸new                 │
  │ Remote boards ▸new      │      │   1 plain fetch (free)               │
  │  Remotive · RemoteOK    │      │   2 headless render (self-hosted     │
  │  WWR · Himalayas        │      │     Firecrawl/Playwright, SPA-only)  │
  ├─────────────────────────┤      │   3 Gemini extract (no-schema pages) │
  │ HN Who-is-Hiring ▸new   │      └──────────────┬───────────────────────┘
  │ NCS / PSU notices ▸new  │                     │
  └────────────┬────────────┘                     │
               └───────────────┬──────────────────┘
                               ▼
              ┌────────────────────────────────────┐
              │ NORMALIZE + ENRICH pipeline        │
              │  salary (INR lakhs→USD) · location │
              │  taxonomy (Bengaluru=Bangalore,    │
              │  SDE=SWE) ▸new · embedding ▸new    │
              ├────────────────────────────────────┤
              │ DEDUP ▸new                         │
              │  content-hash (company+title+loc)  │
              │  canonical-URL: ATS > aggregator   │
              ├────────────────────────────────────┤
              │ LIFECYCLE ▸new                     │
              │  per-crawl sweep → closedAt        │
              │  validThrough honor · age-out 14d  │
              └────────────────┬───────────────────┘
                               ▼
              ┌────────────────────────────────────┐
              │ Postgres (Prisma)                  │
              │  Job (＋closedAt, dedupKey,        │
              │      embedding vector ▸new)        │
              │  GIN FTS index + pgvector ▸new     │
              │  partial idx WHERE closedAt IS NULL│
              └────────────────────────────────────┘

═════════════════════════ SERVING PLANE (request path) ══════════════════════════

  user query
      │
      ▼
  ┌──────────────────────┐   on LLM failure ▸new:
  │ Query parser (Gemini)│──── regex fallback (location/years/seniority),
  │  +yearsExperience    │     never role=rawQuery
  │  +taxonomy expansion │
  └──────────┬───────────┘
             ▼
  ┌─────────────────────────────────────────────┐
  │ LAYER A: hybrid retrieval ▸new              │
  │   FTS (OR-relaxed) ∪ pgvector cosine        │
  │   post-filters: location ▸new · remote ·    │
  │   closedAt IS NULL ▸new · lastSeenAt < 14d  │
  └──────────┬──────────────────────────────────┘
             │ < threshold hits?
             ▼ yes
  ┌─────────────────────────────────────────────┐
  │ LAYER B: Exa fallback                       │
  │   userLocation from parse ▸new (not "US")   │
  │   denylist + URL classifier + JSON-LD check │
  │   lazy HEAD re-verify of top URLs ▸new      │
  └──────────┬──────────────────────────────────┘
             ▼
  ┌─────────────────────────────────────────────┐
  │ RERANKER (Gemini, batched ≤15/call ▸new)    │
  │   merged A∪B, deduped by content-hash ▸new  │
  └──────────┬──────────────────────────────────┘
             ▼
  SSE stream → React UI
   chips · ranked results · "verified active Xh ago" badge ▸new
   closed jobs: banner + similar-roles, never 404 ▸new

══════════════════════════ FEEDBACK PLANE (offline) ═════════════════════════════

  EventLog (real queries) ──▶ weekly triage ──▶ golden-query set (India-first)
  JobSpy benchmark ▸new ──▶ coverage % report (Naukri/Indeed diff, never served)
  user "bad match" feedback ──▶ closure signals + denylist candidates
```

Key properties of the end state:
- **Ingestion is the moat** — serving stays thin (parse → retrieve → rerank);
  all the new complexity lives in offline cron jobs that can fail safely.
- **Every job has a lifecycle** — firstSeen → re-confirmed each crawl → closed;
  nothing is served without a freshness guarantee.
- **Layer B shrinks over time** — as Layer A recall improves (hybrid retrieval +
  bigger corpus), Exa fires less, which cuts both cost and junk.
- **Three planes, three failure domains** — a broken adapter can't take down
  search; a broken reranker degrades to retrieval order, not 0.5-ties.

---

# ADDENDUM — MAX-INDIA COVERAGE PLAN

Added 2026-06-10 after the question "will this cover all India jobs?"
Answer: no plan covers *all* of them — the goal is **maximum legal coverage**.
This addendum stacks every legal channel and states the realistic ceiling.

## The honest denominator

The Indian tech market is roughly 150–300k active public openings at any time
(Naukri lists ~400k+ but a large share is consultancy duplicates and expired
posts). A meaningful chunk of Indian hiring — walk-in drives, WhatsApp groups,
referral-only — never gets a public URL at all and is unreachable by any
search engine, including Naukri.

## Structurally unreachable (without partnership)

1. **Naukri exclusives** — posts that exist only on Naukri (services firms,
   agencies, non-tech-forward employers). TOS-protected; Info Edge litigates.
   Aggregators only carry the *syndicated* slice.
2. **LinkedIn-only postings** — partner API only.
3. **TCS/Infosys/Wipro/HCL direct portals** — SSO/Cloudflare-walled; the
   largest Indian tech employers by headcount. Playwright might crack some at
   permanent maintenance cost.
4. **No-public-URL hiring** — walk-ins, WhatsApp, referrals.

## The max-coverage stack (ordered by yield per effort)

**Tier 1 — aggregator API stack (the multiplier).**

| Option | Inventory | Effort | Risk | $/mo |
|---|---|---|---|---|
| W1. Adzuna IN (already planned, A) | ~10–12k/mo free tier | S | Low | $0 |
| W2. Talent.com publisher XML feeds | One of the largest India inventories anywhere; explicitly wants republishers | S | Low | $0 |
| W3. Careerjet affiliate API | Solid India coverage | S | Low | $0 |
| W4. Jooble partner API (on request) | Large syndicated set | S | Low | $0 |

Four aggregators behind the one generic feed adapter + dedup ≈ most of the
"syndicated India" universe: realistically **50–150k unique Indian jobs**.
This is the single biggest legal jump available. Folded into Move 2.

**Tier 2 — JSON-LD at scale (the structural cheat code).**

| Option | Why it works | Effort | $/mo |
|---|---|---|---|
| X1. Web Data Commons / Common Crawl JobPosting extracts as a *discovery seed* | Google for Jobs forces schema.org JobPosting JSON-LD, so nearly every serious Indian employer embeds it server-side. WDC ships pre-extracted structured data, free. Stale (weeks) — use for discovery, then crawl live. | M | $0 |
| X2. Scale the existing JSON-LD crawler from 12 seeds to thousands | Seeds: WDC + ATS-probe rejects + MCA registry / funding lists | M | ~$5 crawl compute |
| X3. Tiered fetcher with headless rendering (self-hosted Firecrawl or Playwright) | Fixes the crawler's known blind spot: SPA career pages that render JobPosting JSON-LD client-side. Tier 1 = plain fetch (free, covers server-rendered pages). Tier 2 = headless render, fired ONLY when Tier 1 finds no JSON-LD on a page that looks like a job-board shell; cache the per-domain decision. Tier 3 = Gemini Flash extraction on rendered markdown for pages with no schema markup at all (~$0.0002/page) — reaches a coverage class nothing else in the plan does. | M | ~$5–10 (small VPS for the renderer) |

**X3 cost warning:** hosted Firecrawl is priced per page (~1 credit/page) and
job ingestion is a high-page-count workload (1,000 companies × ~30 pages ×
2-level crawl, refreshed weekly ≈ 250k+ pages/mo → deep into $100s/mo tiers).
Do NOT use hosted Firecrawl as the default fetcher. Firecrawl is open source —
self-host it in Docker (or use bare Playwright) so marginal page cost is ~zero.
Use the hosted free tier (500 credits) only to prototype extraction quality
before building. Anti-bot/stealth features help with mildly defended pages but
will not crack Cloudflare-walled Workday tenants.

This tier is the only channel that reaches Indian companies on NO standard ATS —
the segment both aggregators and ATS adapters miss. Folded into Move 3.

**Tier 3 — ATS long tail, India-specific.** Already in the main plan
(B, C, D) plus SuccessFactors OData added to Move 5.

**Tier 4 — sources nobody else bothers with.**

| Option | Inventory | Effort | Risk |
|---|---|---|---|
| Y1. NCS (ncs.gov.in) — the government's own aggregator, includes private listings | thousands | S–M | Low (public service) |
| Y2. PSU/govt tech notices (ISRO, DRDO, BHEL, NIC, bank IT wings) | small, high differentiation | S–M | Low |
| Y3. iimjobs / Hirist / Cutshort / Instahyre — partnership EMAILS, not scrapes | real inventory if any say yes | S (an email) | None; worst case ignored |

**Tier 5 — user-powered (the only legal route to exclusives).**

| Option | Why | Effort | When |
|---|---|---|---|
| Z1. Browser extension capturing jobs the user views (incl. Naukri/LinkedIn) | User-initiated capture is legally far cleaner than scraping; the only path to exclusive inventory | L | Q2, once there is traffic |
| Z2. Self-serve employer posting | Free inventory + the start of a moat | M | Q2+ |

## Realistic ceiling, stated plainly

| Plan | Indian coverage of publicly-posted tech jobs |
|---|---|
| Current corpus | ~0.1% |
| 90-day plan as originally written | ~20–30% |
| 90-day plan + this addendum (Tiers 1–4) | **~50–70%** |
| + browser extension at scale (Tier 5) | creeps higher; exclusives remain partnership-gated |

50–70% would put OpenRoleKB above every Indian job site except Naukri itself —
with direct-employer URLs instead of consultancy spam, which is a *better*
corpus, not merely a comparable one.

## Strategic framing

"All India jobs" is the wrong target — even Naukri doesn't have all of them.
The winnable position is:

1. **Best coverage of direct-employer postings** (ATS + JSON-LD career pages) —
   higher quality than aggregator listings: no staffing-agency noise, no
   expired posts, no fake salary bands.
2. **Best search over what's indexed** — a Hyderabad query that actually works
   beats 400k jobs behind a broken parser.

You can't out-inventory Naukri; you can out-quality it. Inventory breadth comes
from the aggregator stack; differentiation comes from corpus cleanliness +
retrieval quality. Both are in this plan; neither requires a lawsuit.

---

# APPENDIX — PRIOR ART & REUSABLE OPEN SOURCE (verified 2026-06-10)

| Project | What it is | What we take | Status/risk |
|---|---|---|---|
| **Hiring.cafe** | Closest direct competitor: crawls employer sites/ATS directly, AI search, strong following. US-centric. | The UX/quality bar to beat; proof the thesis works. India-first remains our open lane. | Closed source |
| **Google for Jobs** | The reason JSON-LD JobPosting markup is ubiquitous | The ecosystem our Tier-2 crawler exploits | — |
| **OpenPostings** (Masterjx9, 262★) | OSS ATS aggregator; cloned + inspected: ships `jobs.db` with 61,610 companies across 80+ ATSs — 7,304 on our supported ATSs, 1,751 Zoho Recruit, 2,389 iCIMS. `server/ats/` has 80+ adapter implementations. | Tenant lists for Move 3 (180x our current 40 companies); adapter reference code for Move 5 | **NO license file** → ask maintainer, or regenerate the list with their public technique. Don't vendor code. |
| **JobSpy** (speedyapply, 3.6k★, MIT) | Python scraper for Naukri, Indeed (country='India'), Glassdoor, LinkedIn, Bayt, BDJobs | Coverage benchmark only (W0) — never an ingest source for TOS-protected boards | License clean; target-site TOS is the constraint |
| **JobFunnel** | Static-HTML-era scraper | Nothing — bitrotted | Skip |
| **Apify ATS actors** | Paid per-result Greenhouse/Lever/Ashby pulls | Nothing — we already built the same adapters | Skip |
| **Fantastic.jobs / TheirStack / Coresignal** | Commercial pre-aggregated job feeds, $100s–1000s/mo | Benchmark for what "complete" looks like; buy-vs-build reference | Over budget |

Strategic takeaway: the direct-employer-index thesis is **validated** (Hiring.cafe)
but not winnable on global breadth — they have a multi-year head start. The open
lane is **India-first**: Darwinbox/Keka/Zoho Recruit/NCS/GCC coverage + Indian
query understanding (Bengaluru=Bangalore, lakhs, "2–4 yrs", SDE-II) is exactly
what a US-centric product won't prioritize. Generic remote/US coverage is table
stakes; India depth is the moat.
