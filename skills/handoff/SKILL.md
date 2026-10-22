---
name: handoff
description: Write a lean handoff brief for a new Claude session and, when asked, start the successor (natively in Claude Desktop, or via a ready-to-run command elsewhere). Use when the user says "handoff", "hand this off", "write a handoff", "continue in a new session", "prep this for another session", or before ending a long session whose work continues elsewhere.
argument-hint: "What will the next session be used for?"
---

## 1. Write the brief

Current models plan and explore well on their own. What they cannot recover is what only this session knows. Write that, in this order:

- **Live state** - anything armed, running, or half-applied (background jobs, deploys, open PRs, uncommitted changes, branch and worktree path).
- **Goal + done** - the outcome in one line and the checkable evidence that proves it.
- **Decisions and why** - including approaches rejected, so the successor does not retry them.
- **Gotchas found** - environment quirks, corrected assumptions, traps hit.
- **Next step** - the single first action.
- **Boundaries** - what needs the user's OK (push, merge, posting, prod writes) and what is out of scope.

Reference, never copy, existing artifacts (PRDs, plans, issues, commits, diffs) by path or URL. Claims about prod/data carry evidence or say "unverified". Redact secrets, tokens, PII. If the user passed arguments, tailor the brief to that focus. Aim for under ~60 lines.

Save to the session scratchpad or OS temp dir, never the workspace. If the user only asked for the brief, stop here: print the path and offer the start in one line.

## 2. Start the successor

**Claude Desktop** - if `mcp__ccd_session__start_session` exists (load via ToolSearch if deferred):

- `context: "fresh"` (default): `prompt` = goal, files/area, done criteria, next step; `background` (required, 80+ chars) = live state, decisions, gotchas, boundaries. Use `context: "fork"` only when the conversation is short and the full transcript is worth carrying.
- User asked to start it (typed /handoff to continue, "start a new session"): `initiation: "user_asked"`, no extra yes/no.
- Skill fired on your own judgment (context filling up): `initiation: "offer"` with only a `title`, alone in its message; if they pick New session, send `prompt` + `background` with the returned `proposal_id`.
- `use_worktree: true` if it may edit files this session also touches.
- Bold title line plus one sentence right before the call; afterwards link it as `[title](#local_<id>)` with the id from the result.

Use `mcp__ccd_session__hand_off_to_session` only when the user sends an unrelated request mid-task and the current task must move out.

**Anywhere else** - ask once, plain yes/no, then give a "Start the next session" block, run from the repo or worktree the work lives in:

1. Fresh (default): `claude --model <this session's model id> "<next action>. Brief: <brief path>"`
2. Full context instead: `claude --resume <this session id> --fork-session --model <model id>` (same directory as this session; session id from the `session-id: <id>` line the SessionStart hook prints, otherwise say it is unknown).

The brief path must be readable from the successor's directory; if not, paste the brief inline instead.
