---
name: model-router
description: Decide which model tier to delegate a task to, using the accumulated routing journal of past delegation outcomes — and record new outcomes after each run so routing gets smarter over time. Use when orchestrating subagents or workflows and choosing model/effort per stage, when the user asks "which model should handle this", or after a multi-agent run completes (to journal the results).
---

# Model Router

Model selection is an empirical question, not a vibe. This skill maintains a **routing journal** — one row per delegation outcome — and routes new tasks by that evidence. It applies to ANY frontier model running the main loop (Claude Fable/Opus, GPT, Grok, …): the orchestrator's job is decomposition, delegation at the lowest capable tier, and synthesis; the journal tells it what "capable" means per task kind.

## Capability tiers (vendor-neutral)

Route by TIER, then map the tier to whatever vendor(s) your harness can actually spawn:

| Tier | Role | Anthropic | OpenAI | xAI | via OpenRouter |
|------|------|-----------|--------|-----|----------------|
| SMALL | search, fetch/extract, mechanical transforms, sweeps | haiku | gpt-*-mini/nano | grok-mini | any cheap instruct model |
| MID | verify/judge, scoping, per-source analysis, routine code | sonnet | gpt (standard) | grok | mid-tier model |
| LARGE | hard self-contained work: complex debugging, multi-file code, high-stakes judging | opus (effort high); fable above it only when the main loop is not Fable (unproven until the journal has rows for it in that role) | frontier + high reasoning | grok (max reasoning) | frontier model |
| MAIN LOOP | orchestration, final synthesis, strategy — never delegated | whatever runs the session | ″ | ″ | ″ |

Journal rows record the CONCRETE model (`vendor:model(effort)`, e.g. `anthropic:haiku`, `openai:gpt-x-mini`) so evidence transfers when you switch vendors: tier history is suggestive across vendors, exact-model history is authoritative.

**Harness honesty:** inside Claude Code, the Agent/Workflow `model:` parameter spawns Anthropic models only (`haiku`, `sonnet`, `opus`, `fable`, or a full id; on the Anthropic API `sonnet` = Sonnet 5.5, `opus` = Opus 5.5, `fable` = Fable 5.1) — cross-vendor delegation needs an external path (an OpenRouter/LiteLLM-backed MCP tool or CLI the orchestrator shells out to). The skill and journal are portable to any harness (an OpenAI- or xAI-based agent runner can adopt both verbatim); what varies is which column of the tier table is executable.

## The journal

Location: `~/.claude/routing-journal.md` (create on first use). Format — one markdown table, append-only:

```
| date | task-kind | model(effort) | n | outcome | note |
|------|-----------|---------------|---|---------|------|
| 2026-07-10 | web-fetch-extract | haiku | 20 | clean | structured claims, 0 errors |
| 2026-07-10 | cross-agent-synthesis | sonnet | 1 | FAILED | returned placeholder junk |
```

`task-kind` is a stable slug (reuse existing kinds before inventing new ones). `n` = how many agents of that kind in the run. `outcome`: clean / degraded (usable but thin) / FAILED.

## Routing procedure

1. Classify the task into a `task-kind` (check the journal's existing kinds first).
2. Look up that kind in the journal:
   - A tier with consistent `clean` history → use it (prefer the exact journaled model when your harness offers it).
   - `FAILED`/`degraded` at a tier → start one tier higher.
   - No history → tier default: SMALL for search/fetch/mechanical, MID for verify/scope/routine code, LARGE for hard self-contained work.
3. Never delegate regardless of journal: final cross-agent synthesis, strategy/architecture decisions, anything needing the full conversation context. These stay in the main loop — the journal's own seed data shows why.
4. Keep subagent prompts narrow and self-contained; the orchestrator keeps the strategy.
5. On junk/thin output: retry once at the next tier up, then pull into the main loop. Journal both attempts.

## After the run (the part everyone skips)

Append one row per (task-kind, model) pair from the run, with honest outcomes. A journal that only records successes routes no better than the static ladder. Update rows are cheap; re-running a failed stage on a frontier model is not.

## Patch proposals (GEPA-lite)

The journal doesn't just route new work — it also feeds back into the skills it routed to. The nightly `skill-harvest.sh` job scans `~/.claude/routing-journal.md` for FAILED/degraded rows from the last 3 days that implicate an existing skill (task-kind or note names a skill in `~/.claude/skills/`). For each match it writes a patch proposal to `~/.claude/skills-drafts/patches/<skill-name>-<date>.md`: the failing journal row quoted verbatim, a root-cause hypothesis, and a concrete diff against the live `SKILL.md`. These are proposals only — the harvester never edits `~/.claude/skills/` directly. A human reviews and applies (or discards) each proposal. Most days produce zero; that's expected, not a bug.
