# OpenRoleKB Cost Model

This document outlines the marginal cost per active user per month based on real telemetry from `EventLog.exaCostUsd` and `EventLog.llmCostUsd`.

**Source of truth for the numbers used in code / dashboards**: `src/lib/config.ts` (EXA_USD_PER_REQUEST, GEMINI_USD_PER_1K_TOKENS, etc.). Update this doc when they change.

## Current Pricing Assumptions (as of 2026-06)
- **Exa Search**: $0.005 per request (1 request = 50 results)
- **Gemini Flash (latest, ≈ 2.5-flash)**: ~$0.0014 per 1K tokens (blended input + output, $0.30/M in + $2.50/M out)

## Cost Per Search Breakdown
| Component | Avg Cost per Search | Notes |
|-----------|---------------------|-------|
| Exa API   | $0.005              | Flat rate per query |
| Gemini    | ~$0.0051            | ~3.6k tokens avg (parse ≈150, rerank ≈3500 at 50 results) |
| **Total** | **~$0.0101**        | Per successful search |

## Monthly Cost per User by Search Volume
| Searches / Month | Exa Cost | LLM Cost | Total Marginal Cost |
|------------------|----------|----------|---------------------|
| 10               | $0.050   | $0.051   | **$0.101**          |
| 30               | $0.150   | $0.153   | **$0.303**          |
| 100              | $0.500   | $0.510   | **$1.010**          |

## Gross Margin at Proposed Price Points
| Tier  | Price / Mo | Searches Included | Marginal Cost (30 searches) | Gross Margin |
|-------|------------|-------------------|-----------------------------|--------------|
| Free  | $0         | 30                | $0.30                       | N/A (Loss leader) |
| Plus  | $8         | Unlimited         | ~$1.01 (est. 100 searches)  | **~87%**     |
| Pro   | $24        | Unlimited + API   | ~$3.03 (est. 300 searches)  | **~87%**     |

## Key Takeaways
1. Free tier marginal cost (~$0.30 at 30 searches/month) is still below $0.50, but the buffer is much tighter than the previous DeepSeek model afforded — watch the free-tier ceiling.
2. LLM cost is now comparable to Exa per search (Gemini ≈ Exa), no longer negligible. If margin pressure shows up, consider `gemini-2.5-flash-lite` for the rerank pass.
3. Proposed pricing still clears 85%+ gross margins; revisit if Gemini raises prices or rerank token usage drifts upward.

*Note: Update these numbers monthly using the `/admin/health` dashboard or direct DB queries.*
