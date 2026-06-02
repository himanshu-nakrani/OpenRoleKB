# OpenRoleKB Cost Model

This document outlines the marginal cost per active user per month based on real telemetry from `EventLog.exaCostUsd` and `EventLog.llmCostUsd`.

## Current Pricing Assumptions (as of 2026-06)
- **Exa Search**: $0.005 per request (1 request = 50 results)
- **DeepSeek Chat (v3)**: $0.00027 per 1K tokens (blended input + output)

## Cost Per Search Breakdown
| Component | Avg Cost per Search | Notes |
|-----------|---------------------|-------|
| Exa API   | $0.005              | Flat rate per query |
| DeepSeek  | ~$0.00015           | ~500 tokens avg (parse + rerank) |
| **Total** | **~$0.00515**       | Per successful search |

## Monthly Cost per User by Search Volume
| Searches / Month | Exa Cost | LLM Cost | Total Marginal Cost |
|------------------|----------|----------|---------------------|
| 10               | $0.05    | $0.0015  | **$0.0515**         |
| 30               | $0.15    | $0.0045  | **$0.1545**         |
| 100              | $0.50    | $0.0150  | **$0.5150**         |

## Gross Margin at Proposed Price Points
| Tier  | Price / Mo | Searches Included | Marginal Cost (30 searches) | Gross Margin |
|-------|------------|-------------------|-----------------------------|--------------|
| Free  | $0         | 30                | $0.15                       | N/A (Loss leader) |
| Plus  | $8         | Unlimited         | ~$0.50 (est. 100 searches)  | **~94%**     |
| Pro   | $24        | Unlimited + API   | ~$1.50 (est. 300 searches)  | **~94%**     |

## Key Takeaways
1. Free tier marginal cost is well below the $0.50/month threshold at 30 searches/month.
2. LLM costs are negligible compared to Exa search costs.
3. The proposed pricing provides >90% gross margins even at high usage volumes.

*Note: Update these numbers monthly using the `/admin/health` dashboard or direct DB queries.*
