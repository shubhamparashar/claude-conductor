#!/bin/bash
# Daily skill harvester (Hermes-style procedural memory): scan the last 24h of
# Claude Code session transcripts for solved multi-step problems and DRAFT
# reusable skills into ~/.claude/skills-drafts/ for human review. Drafts are
# never written into ~/.claude/skills/ directly, so nothing auto-activates.
# Phase 2 (GEPA-lite): turns FAILED/degraded routing-journal rows that
# implicate an existing skill into patch proposals under skills-drafts/patches/.
#
# Config (env or edit here):
#   CONDUCTOR_HARVEST_MODEL - worker model (default: claude-sonnet-5-5)
#   CONDUCTOR_CLAUDE_BIN    - claude binary (default: first `claude` on PATH)
set -u

DRAFTS="$HOME/.claude/skills-drafts"
LOGDIR="$HOME/.claude/automation/logs"
MODEL="${CONDUCTOR_HARVEST_MODEL:-claude-sonnet-5-5}"
CLAUDE_BIN="${CONDUCTOR_CLAUDE_BIN:-$(command -v claude || echo "$HOME/.claude/local/claude")}"
mkdir -p "$DRAFTS/patches" "$LOGDIR"
LOG="$LOGDIR/skill-harvest-$(date +%Y-%m-%d).log"

# Recent session transcripts (top-level *.jsonl only; subagent transcripts live
# deeper and would add noise). Skip tiny sessions - no procedure worth keeping.
RECENT=$(find "$HOME/.claude/projects" -maxdepth 2 -name '*.jsonl' -mtime -1 -size +100k 2>/dev/null | head -20)
if [ -z "$RECENT" ]; then
  echo "$(date): no substantial sessions in last 24h, skipping" >> "$LOG"
  exit 0
fi

cd "$HOME"

PROMPT="You are a skill harvester. Below is a list of Claude Code session transcripts (JSONL) from the last 24h.

For each transcript: skim it (read selectively - these files are large; grep for tool_use density and user asks rather than reading whole files) and identify tasks that (a) took 5+ tool calls to solve, (b) produced a reusable PROCEDURE (a how-to another session could follow: a debugging recipe, a verification loop, a multi-step integration), and (c) are NOT already covered by an existing skill - check ~/.claude/skills/, the project's .claude/skills/ and .claude/commands/ before drafting.

For each genuinely new procedure (expect 0-2 per day; most days zero - do NOT force drafts), write a draft skill to $DRAFTS/<kebab-name>/SKILL.md with proper frontmatter (name, description with trigger phrases) and concise steps including the gotchas actually hit in the session. These are DRAFTS for human review - do not write anything into ~/.claude/skills/ or any project's .claude/skills/.

Finish by printing one line per new-skill draft created (or 'no new skills worth drafting').

PHASE 2 - patch proposals for existing skills that failed in practice:
Read ~/.claude/routing-journal.md (skip this phase if it doesn't exist). Find rows dated within the last 3 days whose outcome is FAILED or degraded AND whose task-kind or note references a skill in ~/.claude/skills/ (match by name). For each such row: read the matching skill's SKILL.md, and if the referenced session transcript is still findable among the transcripts above, skim it for what actually went wrong. Write a patch proposal to $DRAFTS/patches/<skill-name>-<date>.md containing three sections: 'What failed' (quote the journal row verbatim), 'Root cause hypothesis', and 'Proposed patch' (a unified diff or clear before/after block against the live SKILL.md). NEVER edit ~/.claude/skills/ directly - proposals only. Expect zero matching rows most days; do not force a patch when nothing in the journal actually implicates an existing skill.

Finish by printing one line per patch proposal created (or 'no patch proposals').

Transcripts:
$RECENT"

{
  echo "===== skill harvest started $(date) ====="
  "$CLAUDE_BIN" -p "$PROMPT" \
    --model "$MODEL" \
    --permission-mode bypassPermissions \
    --add-dir "$HOME/.claude"
  CLAUDE_EXIT=$?
  echo "===== finished $(date) (exit $CLAUDE_EXIT) ====="
} >> "$LOG" 2>&1
exit "$CLAUDE_EXIT"
