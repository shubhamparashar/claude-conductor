#!/usr/bin/env node
// SessionStart hook: inject the model-routing escalation ladder so every
// session (regardless of which model runs the main loop) delegates work at
// the lowest capable tier and reserves the frontier model for orchestration.
// If a project-agnostic rule file already covers this (model-routing*.md under
// ~/.claude/rules, ~/.claude/rules-detail, or $CONDUCTOR_RULES_DIR - colon-separated),
// print a one-line pointer instead of duplicating the full ladder every SessionStart.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dirs = (process.env.CONDUCTOR_RULES_DIR || '').split(':').map((d) => d.trim()).filter(Boolean);
dirs.push(join(homedir(), '.claude', 'rules'), join(homedir(), '.claude', 'rules-detail'));
let ruleFile = null;
for (const d of dirs) {
    try {
        const f = existsSync(d) && readdirSync(d).find((n) => /^model-routing.*\.md$/.test(n));
        if (f) { ruleFile = join(d, f); break; }
    } catch { /* unreadable dir: keep looking */ }
}

if (ruleFile) {
    console.log(`<conductor-model-routing>Delegation ladder: see ${ruleFile}; journal at ~/.claude/routing-journal.md</conductor-model-routing>`);
} else {
    console.log(`<conductor-model-routing>
Delegation ladder for spawned agents (Agent tool 'model:' / Workflow agent() opts.model + opts.effort). Pick the LOWEST tier that can do the task; escalate one tier on evidence of failure (junk/thin output -> retry once at next tier, then do it in the main loop):
- haiku: web search, source fetch/extraction, broad codebase exploration, mechanical transforms, log/data sweeps.
- sonnet: scoping, verification/judging, per-source analysis, routine coding subtasks. Self-contained multi-file coding DEFAULTS here, not to the main loop - spec it narrowly and delegate; keep it in the main loop only when it needs cross-cutting session context.
- opus + effort "high": hard but self-contained work - complex debugging, multi-file coding, high-stakes judging.
- Main loop (never delegated): cross-agent synthesis of final deliverables, strategy/architecture decisions, plan authoring, anything needing full conversation context.
Context discipline: subagents get narrow, SELF-CONTAINED tasks with only the inputs they need - never the overall strategy or cross-cutting state. If a task can't be phrased self-contained, it isn't delegable. When invoking saved Workflows, pin model:/effort: per stage in the script; worker stages must not silently inherit the main-loop model, and synthesis stages should return raw material for the main loop to synthesize.
Evidence over defaults: if ~/.claude/routing-journal.md exists, consult it (via the model-router skill) before picking tiers for a multi-agent run, and append outcomes afterward.
</conductor-model-routing>`);
}
