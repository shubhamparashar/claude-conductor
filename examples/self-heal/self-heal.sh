#!/bin/bash
# Self-heal loop: activates ONLY when the conductor-doctor watcher has OPEN
# failures in ~/.claude/conductor-report.md. Spawns a headless worker-model
# session to investigate and fix locally, commenting progress on the linked
# GitHub issue. The doctor owns issue closure (auto-closes when the check
# passes again). Schedule daily via launchd/cron; exits instantly when healthy.
#
# Config (env or edit here):
#   CONDUCTOR_REPO_DIR   — plugin checkout to run checks from (default: ~/repo/claude-conductor)
#   CONDUCTOR_ISSUE_REPO — owner/repo for gh issue comments (optional)
#   CONDUCTOR_HEAL_MODEL — worker model (default: claude-sonnet-5-5)
set -u

REPORT="$HOME/.claude/conductor-report.md"
REPO_DIR="${CONDUCTOR_REPO_DIR:-$HOME/repo/claude-conductor}"
ISSUE_REPO="${CONDUCTOR_ISSUE_REPO:-}"
MODEL="${CONDUCTOR_HEAL_MODEL:-claude-sonnet-5-5}"
LOGDIR="$HOME/.claude/automation/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/self-heal-$(date +%Y-%m-%d).log"

grep -q '^## \[OPEN\]' "$REPORT" 2>/dev/null || exit 0

cd "$REPO_DIR" || cd "$HOME"

ISSUE_STEP=""
if [ -n "$ISSUE_REPO" ]; then
  ISSUE_STEP="4. If the entry has an 'issue: #N' line, comment your findings and what you did on that issue: gh issue comment N --repo $ISSUE_REPO --body '<one-paragraph status>'. If you could NOT fix it, the comment must say exactly what a human needs to do."
fi

PROMPT="You are the conductor self-heal loop. Read $REPORT. For each [OPEN] entry:
1. Investigate the failing check — the checks live in hooks/conductor-doctor.mjs in this repo ($REPO_DIR) and the runtime artifacts under ~/.claude/ (hooks, skills, session-index.db, settings.json).
2. Attempt a LOCAL fix if one is safe and obvious (restore a missing file from the repo copy, delete a corrupted session-index.db so it rebuilds, fix invalid JSON). Local changes only — do NOT commit, push, or close any GitHub issue; the doctor auto-closes issues when its check passes.
3. Re-run the failing check to confirm: echo '{}' | node hooks/conductor-doctor.mjs \"\$PWD\" (silence for the fixed check = healthy; the doctor flips the report entry on its next run).
$ISSUE_STEP
Finish with one line per entry: <check-id>: fixed|needs-human <summary>."

{
  echo "===== self-heal started $(date) ====="
  claude -p "$PROMPT" \
    --model "$MODEL" \
    --permission-mode bypassPermissions \
    --add-dir "$HOME/.claude"
  echo "===== finished $(date) (exit $?) ====="
} >> "$LOG" 2>&1
