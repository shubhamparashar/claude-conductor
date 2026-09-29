# Skill harvest automation (macOS launchd)

Hermes-style procedural memory: a nightly headless session skims the last 24h of Claude Code transcripts for solved multi-step problems and drafts reusable skills into `~/.claude/skills-drafts/` for human review. Nothing is written into `~/.claude/skills/` directly, so no draft ever auto-activates - you promote a draft by moving its directory into `~/.claude/skills/` after reading it.

Phase 2 (GEPA-lite, pairs with the `model-router` skill): FAILED/degraded rows in `~/.claude/routing-journal.md` that name an existing skill become patch proposals under `~/.claude/skills-drafts/patches/` - never direct edits.

Expect 0-2 drafts per day; the prompt explicitly forbids forcing drafts, and days with no substantial sessions exit instantly.

## Install

```bash
cp skill-harvest.sh ~/.claude/automation/skill-harvest.sh && chmod +x ~/.claude/automation/skill-harvest.sh
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE_BIN__|$(dirname "$(command -v node)")|g" \
    -e "s|com.example|com.$(whoami)|g" com.example.skill-harvest.plist \
    > ~/Library/LaunchAgents/com.$(whoami).skill-harvest.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.$(whoami).skill-harvest.plist
```

Optional env (set in the plist `EnvironmentVariables` or edit the script): `CONDUCTOR_HARVEST_MODEL` (default `claude-sonnet-5-5` - a worker model on purpose; harvesting is mechanical skimming), `CONDUCTOR_CLAUDE_BIN` (default: `claude` on PATH).

On Linux, run the same script from cron: `45 9 * * * bash ~/.claude/automation/skill-harvest.sh`.

Gotchas:

- launchd does not source your shell rc files - the plist `PATH` must contain the directory holding `node` and `claude` (the `__NODE_BIN__` substitution handles nvm/Homebrew installs). A wrong PATH fails silently: the job shows "loaded" but the log stays empty.
- launchd does not expand `~` - all paths in the plist must be absolute (the `__HOME__` substitution handles this).
- The worker runs with `--permission-mode bypassPermissions` scoped to `--add-dir ~/.claude`; review the prompt in `skill-harvest.sh` before enabling if that trade-off concerns you.

## Reviewing the output

- Drafts: `ls ~/.claude/skills-drafts/` - read each `SKILL.md`, then promote (`mv` into `~/.claude/skills/`), keep as draft, or delete.
- Patch proposals: `~/.claude/skills-drafts/patches/*.md` - apply manually to the live skill if you agree.
- Run log: `~/.claude/automation/logs/skill-harvest-<date>.log`.
