# Embeddings architecture — discussion doc

Status: **parked**, not in scope for current phase. Re-open when we have
either (a) ≥10k searches/day with measurable query overlap, or (b) a
specific user complaint that one of the use cases below would solve.

Captured 2026-06-03 from a session conversation. The user proposed
making the vector DB the *primary* index with Exa as fallback. Below is
why that specific framing is wrong, what the right shape looks like,
and the minimum-viable validation step we'd take when we revisit.

---

## The original proposal

> "After each search add jobs in vector db, and while retrieval first
> retrieve from db and then perform exa search."

Translation: vector-DB-first, Exa-fallback. Search hits the embedded
job corpus first; only if results are insufficient do we call Exa.

---

## Why vector-DB-first is the wrong shape for OpenRoleKB

In decreasing order of severity:

### 1. Job postings are time-sensitive
A 3-day-old listing is worth roughly 5× a 30-day-old one in
apply-conversion terms. Vector DB returns whatever was indexed before.
Exa returns what's live right now. The product's competitive moat is
**freshness**; flipping the priority degrades the headline value.

### 2. Cold start doesn't go away
First user to search "founding engineer, climate tech, Toronto" → vector
DB is empty for that niche → falls through to Exa anyway. The vector DB
only helps after enough overlapping searches accumulate. Until we're at
~10k searches/day with significant overlap, the hit rate is single
digits.

### 3. The product's job is finding jobs the user hasn't seen
Returning the same posting twice is a regression. Saved-search digests
(the cadence feature we just built) explicitly diff against previous
results to surface *new* matches. A vector-first flow optimizes for
**similarity**, which is the opposite objective.

### 4. We'd be rebuilding what Exa already sells us
Exa's whole value-add is neural semantic search over fresh web content.
Embedding our own job corpus and searching it is — at best — a worse,
smaller version of Exa, with a 1–7 day data lag. We'd be paying for Exa
AND our own infra to underperform it.

### 5. The retrieval-then-rerank pipeline already does the semantic work
Today: Exa returns ~50 semantically-near candidates → LLM rerank scores
against the *full* query (including constraints like "no crypto" that
pure embedding-similarity can't capture). Embedding similarity catches
"react" ≈ "frontend"; the rerank LLM catches "remote EU" ≠ "remote US."
We need both, and we're getting both already.

---

## Where embeddings *do* add real value

Six concrete use cases, ordered by leverage. Pick by mapping to a real
user pain we've heard — not "the embeddings stack is cool, where do we
shoehorn it?"

| # | Use case | What it gives us | Effort | Where it lives |
|---|----------|------------------|--------|----------------|
| 1 | **"More like this" on a result click** | Inline expansion: 3 nearest neighbors from the current 50 Exa results | 1 day | New endpoint, no schema change |
| 2 | **Cross-source dedup** | Same job on greenhouse + lever with reworded title → collapse to one card | 2 days | Pre-render filter in `cacheSearch` |
| 3 | **Cadence dedup** | Cron's "new since last run" diff uses cosine similarity, not URL equality. Catches reposts with new IDs | 1 day | Inside `/api/cron/saved-search-run` |
| 4 | **User preference vector** | Average vector of clicked/saved jobs → re-rank future Exa results by alignment | 4–5 days | `User.preferenceVector` + post-Exa boost step |
| 5 | **Warm cache for popular queries** | Cosine-search against *recent* (e.g., <72h old) Job rows. Hit means skip Exa entirely | 3 days | Layered above current 6-hour cache |
| 6 | **Trending-similar widget** | "People who searched X also looked at Y" on the empty landing | 2 days | Daily aggregation job |

Items 1–4 are pure wins. Item 5 (warm cache) is the closest cousin to
the original proposal but scoped to recent jobs only — the freshness
constraint still rules. Item 6 needs traffic before it works.

---

## Cost + complexity (concrete numbers)

### Embedding cost
- OpenAI `text-embedding-3-small`: ~600 tokens per job × 50 jobs/search × $0.02/1M tokens = **$0.0006/search**
- Cheaper than rerank LLM ($0.0015/search), comparable to Exa ($0.005/search)
- Voyage AI `voyage-3-lite`: ~3× cheaper, roughly equivalent quality for short docs. Worth benchmarking.

### Storage (pgvector on Neon)
- 1536-dim float32 = 6KB per job
- 1M jobs = 6GB. Neon free tier is 0.5GB; Pro handles this easily.
- HNSW index adds ~2× overhead → 12GB total at 1M jobs.

### Retrieval latency (pgvector HNSW)
- <50ms for top-k from 1M rows
- vs. Exa 800ms–2s
- Real win for "more like this" and "warm cache" use cases.

### Operational risk
- Embedding model lock-in: vectors aren't comparable across models.
  Switching from OpenAI to Voyage requires re-embedding the entire corpus.
- pgvector is mature on Neon and Supabase. No new infra to operate.
- Index rebuild on schema change is the main pain. Tag rows with
  `embedding_version` from day one to make migrations bearable.

---

## Recommended architecture (when we eventually build this)

Concrete proposal that gives us the upside without breaking the
freshness contract:

```
                       ┌─────────────┐
   User query  ──────► │ Embed query │ (~50ms, ~$0.000001)
                       └──────┬──────┘
                              │
            ┌─────────────────┼─────────────────────┐
            ▼                 ▼                     ▼
   ┌─────────────────┐  ┌──────────┐      ┌────────────────┐
   │ Vector cache    │  │   Exa    │      │ User preference│
   │ (<72h Job rows  │  │ live web │      │ vector (if     │
   │  cosine ≥ 0.85) │  │  search  │      │  signed in)    │
   └────────┬────────┘  └────┬─────┘      └────────┬───────┘
            │                │                      │
            └────────────────┼──────────────────────┘
                             ▼
                  ┌─────────────────────┐
                  │  Merge + dedup by   │
                  │  url + embedding    │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │  Rerank (LLM)       │
                  │  + preference boost │
                  └──────────┬──────────┘
                             ▼
                          Results
```

Key properties:
- **Exa always runs** for live freshness. Non-negotiable.
- **Vector cache supplements**, doesn't replace. Only contributes rows
  fresher than N hours (currently ≤72h).
- **Dedup at the merge step** — same job from Exa + cache → one row.
- **User preference vector** boosts post-rerank scores by
  `alpha * cosine(job, userVector)` with `alpha ≈ 0.1`. Tunable.

---

## Minimum viable first step (when we come back)

If we want to validate the embeddings investment with one weekend of work:

1. Add `Job.embedding vector(1536)` column + pgvector extension on Neon.
2. In `cacheSearch`, embed each new job and write the vector alongside.
3. Add `GET /api/jobs/[id]/similar?k=5` — returns nearest neighbors via cosine.
4. Wire a "More like this" expander in `DetailPane`.

Cost to validate: ~$50/month at current traffic, 1–2 days of work.

**Decision gate:** if users click "more like this" >15% of the time on
jobs they viewed, the embedding investment is paying for itself and we
can layer the harder features on top. If they don't, we've spent two
days and learned something concrete.

---

## Anti-scope (when we revisit, don't sneak these in)

- **Vector DB as primary index** — the thing this doc explicitly argues
  against. If it comes back, re-read sections "Why vector-DB-first is
  the wrong shape" and "Recommended architecture."
- **Custom-trained embedding model** for jobs. Off-the-shelf models are
  good enough until we have ground truth (click-through data over
  ~100k searches).
- **Replacing the LLM rerank with pure embedding cosine.** Cosine can't
  read "no crypto" or "must mention dbt." The rerank LLM is doing real
  work; embeddings supplement it.
- **Embedding the user's resume.** That's a different product
  (resume-matched search). Out of scope per Phase 2 anti-scope list.

---

## What would change our mind

We should re-open this discussion if any of these happen:

1. **Traffic milestone**: ≥10k searches/day AND log analysis shows ≥30%
   query overlap within a 72-hour window. Means a warm vector cache
   would meaningfully reduce Exa spend.
2. **User behavior signal**: Apply-click data shows users frequently
   click jobs that are 7+ days old. Means freshness matters less than
   I'm assuming, and the embedding play is safer.
3. **Cost pressure**: Exa pricing changes meaningfully, or our budget
   alarm (P4.2) fires regularly. Means we need a cheaper retrieval tier.
4. **Specific user complaint**: "I keep seeing similar jobs but not
   identical ones" → cross-source dedup (use case #2) becomes urgent.
5. **Pricing tier requirement**: If Pro tier ($24/mo from `phase2.md`)
   needs a differentiating feature, "personalized rerank" (use case #4)
   is a credible candidate.

Until at least one of those triggers, this stays parked.

---

## Bottom line

**Don't pivot to vector-DB-first.** The freshness contract is the
product's edge over LinkedIn/Indeed. Embeddings are a side-channel that
enriches Exa results, not a primary index that competes with them.

When we do come back to this (signal-driven, not "the embeddings stack
is cool"), the order is: (1) similar-jobs endpoint → measure click-
through → (2) cadence dedup → (3) user preference vector → (4) cross-
source dedup → (5) warm cache → (6) trending widget.
