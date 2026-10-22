---
name: cost-stats
description: Token/cost accounting over Claude Code transcripts — aggregates per-message usage by model, project, or day and prices it at public API rates as an API-equivalent upper bound. Use when the user asks "what am I spending", "token usage stats", "which model burns the most", "cost of my scheduled jobs", or when calibrating the routing ladder with real numbers.
---

# Cost Stats

Every transcript line carries a `usage` block; this sums them. The $ column is **API-equivalent** — subscription usage doesn't bill per token, but API pricing is the honest common denominator for routing decisions ("what would this traffic cost if I paid for it").

## Usage

```bash
python3 <skill-dir>/costs.py --days 7 --by model      # who burns what (default)
python3 <skill-dir>/costs.py --days 30 --by project   # incl. scheduled-job projects
python3 <skill-dir>/costs.py --days 7 --by day --project my-api
```

- Covers main-session AND subagent transcripts (subagents often dominate).
- Scheduled/headless jobs show up under the project dir of their cwd — filter with `--project` to isolate them.
- Pricing table is in `costs.py` (`PRICES`); update it when Anthropic pricing changes.

## When to reach for it

- Before/after changing delegation tiers — did routing legwork to haiku actually move the number?
- Answering "are the scheduled/headless jobs worth moving off the main model?"
- Monthly sanity check that the frontier model is spending tokens on synthesis, not legwork.
