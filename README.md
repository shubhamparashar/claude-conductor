# claude-conductor

Frontier-model budget discipline for Claude Code. Born from a simple observation: if your main loop runs on a frontier model (Opus, Fable), every token it spends on legwork is waste — and everything it learns dies with the session unless something reminds it to write things down.

## What it installs

**Hooks** (active immediately, all sessions):

- `model-routing-context` (SessionStart) — injects a delegation ladder: spawned agents run at the lowest capable tier (haiku → sonnet → opus-high), the main loop keeps orchestration, final synthesis, and strategy, and subagent prompts stay narrow and self-contained so your strategic context never leaks into worker prompts.
- `memory-nudge` (UserPromptSubmit) — every 12th prompt (configurable via `CONDUCTOR_NUDGE_EVERY`), nudges the session to persist durable knowledge — facts to memory, 5+ tool-call procedures as draft skills. Hermes-agent-style agent-curated write-back, no daemon required.

- `claude-md-size-check` (SessionStart) — silent until always-loaded CLAUDE.md content crosses a size threshold (`CONDUCTOR_CLAUDEMD_LIMIT`, default 150k chars); only then suggests the pointer restructure. Chunking small CLAUDE.mds is counterproductive — inline is cheaper below the threshold.
- `post-task-reflect` (Stop) — when a turn ends having used ≥`CONDUCTOR_REFLECT_MIN_TOOLS` tool calls (default 8), flags the session; the very next prompt gets a one-time reflection reminder: draft the procedure as a skill, or patch the existing skill/memory the task proved wrong. Immediate Hermes-style reflection, not batch.
- `goal-contract-gate` (Stop) — if the session has an ACTIVE goal contract (written by the `goal-contract` skill) with unchecked completion criteria, flags it; the next prompt gets a one-time reminder to reopen the contract and check boxes only against pasted evidence before declaring the task done. Never blocks, fails silent, silent once the contract is closed or absent.
- `context-pressure-warn` (PreToolUse Edit|Write) — reads the transcript's latest usage record (input + cache-read + cache-creation = true in-context tokens) and warns once per crossing at 50/75/90% of the model's REAL window (1M; 200k for Haiku), with the cheapest next step (/compact at a task boundary, handoff doc, fork). Warn-only, per-session dedup, fails silent — never blocks a tool call.
- `conductor-doctor` (SessionStart) — self-watcher that only speaks up on misbehavior: fast checks over the plugin's own moving parts (hook references, skill frontmatters, session-index integrity, double registration, skill shadowing, node runtime). Silent while healthy; on failure it upserts an OPEN entry in `~/.claude/conductor-report.md` and writes the SAME entry back to RESOLVED once the problem clears — a self-maintaining bug report, no duplicates. **GitHub mirroring (optional):** set `CONDUCTOR_ISSUE_REPO=owner/repo` (or pass as the hook's second arg) and each new failure opens one GitHub issue, linked in the report entry; recovery closes that same issue with a comment. Requires `gh` authenticated; all GitHub calls are best-effort and never break the health check.

**Self-heal pattern** (not bundled — needs your scheduler): pair the doctor with a cron/LaunchAgent that exits instantly unless the report has `[OPEN]` entries, and otherwise spawns a headless worker-model session to investigate, fix locally, and comment progress on the linked issue. The doctor keeps sole authority to close issues (a check passing is the only definition of fixed). This makes the system self-improving precisely when — and only when — something misbehaves.

**Skills** (invoked on demand):

- `session-recall` — on-demand episodic memory: an incremental SQLite FTS5 index over all past session transcripts (`search.py`, stdlib-only), searchable mid-task with ranked snippets and resume pointers. ~200 sessions index in seconds; auto-reindexes before each search.

- `facts-recall` — semantic complement to session-recall: FTS5 over the distilled knowledge layer (auto-memory files, `~/.claude/rules`, plus knowledge-bundle dirs via `CONDUCTOR_KNOWLEDGE_DIRS` — colon-separated; only point it at dirs you're happy to index into a local plaintext DB). Chunked by heading, credential patterns redacted at index time.
- `knowledge-sync` — distributed persistent memory: syncs the knowledge layer across machines via a private git remote (allowlisted paths only), with git's rebase/merge machinery as the conflict resolver.
- `model-router` — data-driven tier selection: maintains `~/.claude/routing-journal.md` (one row per delegation outcome), routes new tasks by accumulated evidence instead of static defaults, and records outcomes after each run.
- `model-router` also drives GEPA-lite patch proposals: the nightly skill-harvest job turns FAILED/degraded journal rows that implicate an existing skill into human-reviewed patch proposals under `~/.claude/skills-drafts/patches/`. The harvest job itself ships in `examples/skill-harvest/` (script + launchd template + install guide).
- `persist-everywhere` — "add this to the brain / memory / claude.md / everywhere" writes a fact to every knowledge surface in one pass: one canonical copy, condensed pointers elsewhere, dedupe-first.
- `handoff` - compact the live conversation into a handoff document a fresh agent can pick up (live state first, suggested-skills section, secrets redacted), then always end with a "Start the next session" block: a `claude --resume <id> --fork-session` continue command, a paste-ready fresh-session starter pointing at the doc, and the exact model to start it on.
- `hot-cold-review` — dual-perspective PR review: a "hot" reviewer primed with full context (spec/ERD, related merged PRs, known collisions) and a "cold" fresh-eyes reviewer (diff + repo + spec only), run in parallel; findings both raise are high-confidence, and the main loop synthesizes into one SHIP/HOLD. The context asymmetry is the point — identical prompts would just run the same review twice.
- `goal-contract` — write `~/.claude/goal-contracts/<slug>.md` before starting a task: one-line goal, checkbox completion criteria each naming its required evidence, and explicit non-goals. Closing the contract means reopening it, pasting real evidence against every box, and reporting unfinished boxes as NOT done — paired with the `goal-contract-gate` Stop hook so an unchecked contract gets flagged before you can claim done.
- `learn`: on-demand skill distillation: turn what this session just solved (or a path/URL you point at) into a draft skill immediately, while the context is still live. Same drafts lane and human review gate as the nightly harvest, minus the transcript re-reading; checks for an existing skill first and proposes a patch instead of a duplicate.
- `journey`: one recency timeline across every knowledge surface (memories, rules, skills, unreviewed drafts and patches, goal contracts), so the stale rule and the draft that has waited a month are both visible. Read-only; prunes and promotions need per-file confirmation.
- `plugin-vet` — security-scan any third-party plugin/skill/MCP dir BEFORE installing: invisible-Unicode / Trojan-Source / ASCII-tag-smuggling detection plus known supply-chain IOCs (compromised package versions, persistence filenames, exfil domains). Ships two zero-dependency Node scanners under `scripts/security/`; floor-check, verify flagged hits in context.
- `doctor` - the on-demand full checkup complementing the SessionStart watcher, modeled on Claude Code's `/doctor`: runs the scripted checks plus judgment checks scripts can't do (context cost of unused skills/plugins, cross-surface duplication, stale plugin caches, malformed permission rules), reports findings by severity with evidence, and applies fixes only after per-fix confirmation - each fix verified by re-running the check that flagged it.
- `slim-claude-md` — restructures an oversized CLAUDE.md into a lean pointer index + on-demand `rules/` detail files, keeping hard behavioral constraints inline so they can't be bypassed by lazy loading. Threshold-gated via the size-check hook, not a blanket rule.

## Install

From the GitHub repo (works while the repo is private, as long as you have access — the CLI clones over SSH or your existing git credentials):

```bash
claude plugin marketplace add shubhamparashar/claude-conductor
claude plugin install claude-conductor@claude-conductor-marketplace
```

Or the same via `/plugin marketplace add` + `/plugin install` inside a session. From a local clone, use `claude plugin marketplace add /path/to/claude-conductor`.

**Auto-updates on a private repo:** background marketplace refresh runs without git credential helpers, so set `GITHUB_TOKEN` (or `GH_TOKEN`) in your environment to get silent updates; manual `claude plugin marketplace update` uses your normal git credentials either way.

**Team lockdown (optional):** to pin an org to approved marketplaces only, deploy [docs/team-managed-settings.example.json](docs/team-managed-settings.example.json) as managed settings (`/Library/Application Support/ClaudeCode/managed-settings.json` on macOS) — `strictKnownMarketplaces` then rejects any other marketplace add.

**If you previously installed the hooks/skills standalone** (copied into `~/.claude/hooks` + `~/.claude/skills` and wired in `settings.json`): remove those entries before enabling the plugin, or every hook fires twice per session.

## Growth policy — grow without bloat

Research-backed rules (lazy.nvim / Obsidian ecosystem practices, verified 2026-07) that govern what gets added here:

- **One concern per file.** Every hook is a single `.mjs` in `hooks/`, every skill a single dir in `skills/`. To disable a component, delete its `hooks.json` entry (hooks) or its directory (skills) — no config flags, no feature matrix.
- **Dormant until triggered.** Hooks must be silent and near-zero-cost on the happy path (the doctor only speaks on misbehavior; the size-check only above threshold). Skills are invocation-only. Nothing new may do unconditional per-session work.
- **Overlap audit before each minor release.** If a proposed component duplicates part of an existing one, merge or drop it — duplication across modules is the primary bloat vector.
- **Soft deprecation.** Components that fall out of use get flagged here as *deprecated* first and removed a version or two later; no hard deadlines, no breaking surprises.
- **Automated release gate.** Run `scripts/release-check.sh` before tagging: syntax-checks every hook and skill script, validates all JSON manifests, verifies `hooks.json` references and skill frontmatter files exist, and scans tracked files for credentials.

Version history: [CHANGELOG.md](CHANGELOG.md).

## Design notes

- The routing ladder was calibrated empirically: in a 102-agent research run, haiku handled 100% of search/fetch/extract cleanly, sonnet handled adversarial verification well — and sonnet failed cross-agent synthesis, which is why synthesis stays in the main loop.
- The nudge is deliberately low-frequency and self-suppressing ("if nothing durable emerged, continue without comment") — a reminder cadence, not a chore.
- `hot-cold-review` — dual-perspective PR review: a "hot" reviewer primed with full context (spec/ERD, related merged PRs, known collisions) and a "cold" fresh-eyes reviewer (diff + repo + spec only), run in parallel; findings both raise are high-confidence, and the main loop synthesizes into one SHIP/HOLD. The context asymmetry is the point — identical prompts would just run the same review twice.
- `plugin-vet` — security-scan any third-party plugin/skill/MCP dir BEFORE installing: invisible-Unicode / Trojan-Source / ASCII-tag-smuggling detection plus known supply-chain IOCs (compromised package versions, persistence filenames, exfil domains). Ships two zero-dependency Node scanners under `scripts/security/`; floor-check, verify flagged hits in context.
- `slim-claude-md` exists because CLAUDE.md grows monotonically; the two-layer split (binding one-liners inline, detail on demand) is the only version of lazy loading that doesn't break prohibition-style rules.
- Hook stdout is deterministic by design: SessionStart context is byte-identical across sessions (no timestamps, counters, or randomness), so the conversation prefix stays prompt-cache-hot (cache reads bill at 0.1x input price). Dates and mutable state go to files (`conductor-report.md`), never into emitted context. Keep this invariant when adding hooks.
