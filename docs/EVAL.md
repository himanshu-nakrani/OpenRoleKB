# Eval — search-quality regression test suite

A nightly job that asks the live LLM to rerank cached Exa results against a frozen set
of golden queries, then asserts the output still meets each query's expectations.

Without this suite, prompt edits to `src/lib/rerank.ts` are unverifiable. With it,
every change to the rerank rubric (or the underlying model) gets a measurable
pass/fail signal.

## What it tests

10 golden queries in `test/eval/golden-queries.json`. Each case declares
expectations such as:

- **topNMustMatch** — at least half of the top N must score ≥ X and match a title
  pattern.
- **mustExcludeCompanies** — known-bad companies must never appear (the
  "no crypto" filter must actually filter crypto).
- **mustExcludeKeywordsInTitle** — keywords like "blockchain", "smart contract".
- **topResultMinScore** — the single best result must score above a floor.
- **noSeniorRoles** — at most 1 senior-titled job in the top 5 (for junior queries).

Each case yields a 0..1 quality score (passing checks / total checks) plus a
pass/fail flag (all checks passed). The aggregate **pass rate** is the headline
number on `/admin/health` → Quality.

## How it stays cheap and stable

- Exa results are **frozen as snapshots** in `test/eval/exa-snapshots/<hash>.json`.
  The eval never hits Exa during a regular run, so we're measuring **rerank quality
  alone**, not the live ATS landscape. Refresh deliberately with
  `npm run eval:snapshot`.
- Each rerank call costs roughly the same as one production search (~3-4k Gemini
  tokens). 10 cases × nightly = ~$0.10/month at current pricing.

## Running locally

```bash
# Dry-run: synthetic rerank, no API calls. Useful when changing the harness itself.
npm run eval:dry

# Full run against your local Gemini key. Writes EvalRun rows to your local DB.
npm run eval

# Single case
npx tsx scripts/eval.ts --case senior-react-remote-eu-no-crypto

# Skip DB writes
npx tsx scripts/eval.ts --no-write
```

The runner prints a per-case summary to stderr and emits the full JSON report to
stdout. Exit code 1 if any case failed, 2 if the runner itself crashed.

## Refreshing Exa snapshots

Snapshots go stale as job postings expire. Refresh when:

- You add a new golden case (the new query has no snapshot yet).
- A run flags many cases as "no results from Exa".
- You change `src/lib/exa.ts` (different domain filter, different `numResults`, etc.).

```bash
# Refresh all snapshots
npm run eval:snapshot

# One case only
npx tsx scripts/eval-snapshot.ts --only senior-react-remote-eu-no-crypto
```

After refreshing, commit the updated JSON files. Treat the snapshot diff as a
code-review artifact: it's the difference between "what Exa returns today" and
"what it returned at the last baseline."

## Adding a new golden case

1. Pick a query that represents a real user intent the rerank rubric should handle.
2. Append it to `test/eval/golden-queries.json` with explicit expectations.
3. Run `npx tsx scripts/eval-snapshot.ts --only <name>` to capture the snapshot.
4. Run `npm run eval -- --case <name>` to score it. Iterate on expectations until
   they reflect "this is what good looks like for this query."
5. Commit golden + snapshot + any rubric changes together.

## Where to look at history

- **Dashboard** — `/admin/health` shows the latest run's pass rate.
- **Database** — `EvalRun` table; one row per case per run. Run-id, case, score,
  pass/fail, failure messages, tokens, cost, rubric SHA.
- **CI artifacts** — every nightly run uploads `eval-report.json` as a GitHub
  Actions artifact, kept 30 days.

## CI setup

The nightly workflow lives at `.github/workflows/eval.yml`. It runs at 03:17 UTC
and on `workflow_dispatch`. It expects three repo secrets:

| Secret | Why |
|--------|-----|
| `EVAL_DATABASE_URL` | Where EvalRun rows go. Recommend a dedicated DB / branch separate from production. |
| `EVAL_EXA_API_KEY` | Only needed if `refresh_snapshots: true` is passed. |
| `EVAL_GEMINI_API_KEY` | Required. |

A failing run does NOT block PRs (CI only verifies unit + contract). Quality
regressions surface as artifact downloads + a red workflow badge on the eval job.

## Rubric drift

`scripts/eval.ts` computes a SHA of the `RERANK_RUBRIC` string at run time and
records it in each `EvalRun.rubric`. To find when quality changed, group by
rubric SHA in SQL:

```sql
SELECT rubric, COUNT(*) AS runs,
       AVG(score) AS avg_score,
       SUM(CASE WHEN passed THEN 1 ELSE 0 END)::float / COUNT(*) AS pass_rate
FROM "EvalRun"
GROUP BY rubric
ORDER BY MIN("createdAt") DESC;
```

If a rubric change tanked pass rate by > 5%, revert and try again with a smaller
edit.
