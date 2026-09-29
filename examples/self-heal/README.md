# Self-heal automation (macOS launchd)

Pairs with the `conductor-doctor` hook: the doctor writes `[OPEN]` failures to `~/.claude/conductor-report.md`; this scheduled job exits instantly while the report is clean, and otherwise spawns a headless worker-model session to investigate, fix locally, and comment on the linked GitHub issue. The doctor alone decides when an issue is fixed (its check passing) and closes it.

## Install

```bash
cp self-heal.sh ~/.claude/automation/self-heal.sh && chmod +x ~/.claude/automation/self-heal.sh
sed -e "s|__HOME__|$HOME|g" -e "s|__NODE_BIN__|$(dirname "$(command -v node)")|g" \
    -e "s|com.example|com.$(whoami)|g" com.example.conductor-self-heal.plist \
    > ~/Library/LaunchAgents/com.$(whoami).conductor-self-heal.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.$(whoami).conductor-self-heal.plist
```

Optional env (set in the plist `EnvironmentVariables` or edit the script): `CONDUCTOR_REPO_DIR` (plugin checkout), `CONDUCTOR_ISSUE_REPO` (`owner/repo` for issue comments), `CONDUCTOR_HEAL_MODEL` (default `claude-sonnet-5-5` — a worker model on purpose; the fixes are mechanical).

On Linux, run the same script from cron: `15 10 * * * bash ~/.claude/automation/self-heal.sh`.

Note: the worker runs with `--permission-mode bypassPermissions` scoped to `--add-dir ~/.claude` — it can fix runtime artifacts but has no reason to touch anything else; review the prompt in `self-heal.sh` before enabling if that trade-off concerns you.
