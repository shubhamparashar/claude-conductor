---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up, then suggest exactly how to start the successor session. Use when the user says "handoff", "write a handoff", "prep this for another session", or before ending a long session whose work continues elsewhere.
argument-hint: "What will the next session be used for?"
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save it to the OS temporary directory - not the current workspace.

Rules for the document:

- Include a **"suggested skills"** section naming the skills the successor should invoke, with one line each on when.
- Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.
- Redact sensitive information - API keys, passwords, tokens, PII.
- Lead with live state: anything armed, running, or half-applied that the successor must know before touching the system.
- If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## Then suggest the successor session

After writing the document, always end with a **"Start the next session"** block containing, in order:

1. **Continue-in-place command** - resume this session with its context forked:
   ```
   claude --resume <this session id> --fork-session
   ```
   The session id is printed by the SessionStart hook (`session-id: <uuid>`); if absent, say so instead of guessing.
2. **Fresh-session starter** - a paste-ready opening prompt for a brand-new session, of the form:
   `start with this: <handoff doc path>` plus one sentence naming the immediate next action from the doc.
3. **Model note** - name the exact model powering this session, so the successor is started on the same one rather than a default.

If the machine has a local session-spawn script (e.g. `~/.claude/scripts/spawn-desktop-session.sh`), offer - once, plain yes/no - to launch the successor directly with it, passing the handoff path, this session's model id, and this session's id. Do not spawn anything without a yes. If no such script exists, the two commands above are the deliverable; do not invent a spawn mechanism.
