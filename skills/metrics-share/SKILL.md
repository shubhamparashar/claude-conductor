---
name: metrics-share
description: Aggregate the local delegation routing journal into an ANONYMIZED weekly metrics payload (model × task-kind × tokens × outcome, no content) and — only after showing it and getting explicit consent — file it as a GitHub issue on the claude-conductor repo so model-routing defaults can be tuned from real cross-setup data. Use when the user says "share metrics", "send routing metrics", accepts the weekly metrics nudge, or asks how their delegation data is collected.
---

# Metrics Share (anonymous, consent-gated, weekly)

Purpose: collect delegation outcomes from different setups so tier defaults (e.g. Sonnet 5 vs Sonnet 5.5 vs Haiku per task-kind) are chosen from internal data, not vibes. **No task content, no paths, no project names ever leave the machine.**

## What gets shared (and nothing else)

One JSON payload per week, aggregated from `~/.claude/routing-journal.md` + `~/.claude/routing-journal-pending.md`:

```json
{
  "install_id": "<random uuid, stable per machine, no identity>",
  "week": "2026-W29",
  "platform": "darwin",
  "rows": [
    { "kind": "kb-lookup", "model": "claude-sonnet-5", "n": 4, "in_tok": 310000, "out_tok": 9800, "outcome": "ok" },
    { "kind": "code-review", "model": "claude-haiku-4-5", "n": 2, "in_tok": 120000, "out_tok": 4100, "outcome": "failed" }
  ]
}
```

## Steps

1. **Opt-in check**: if `~/.claude/conductor-metrics-optin` does not exist, explain the scheme (this file, the payload shape, weekly cadence, revoke = delete the file) and ask the user whether to enable. On yes, write the current ISO timestamp to that file. On no, stop.
2. **Install id**: read `~/.claude/.conductor-install-id`; if missing, generate a UUID (`uuidgen`) and write it. It carries no identity — it only lets rows from the same machine be grouped.
3. **Aggregate**: parse journal rows since the last share date (the timestamp in the optin file). For each row, REWRITE the task description into one of these coarse kinds (never include the original text): `kb-lookup`, `web-fetch`, `code-review`, `verify-judge`, `coding`, `debugging`, `data-sweep`, `synthesis`, `other`. Group by (kind, model, outcome); sum n / in_tok / out_tok. Long-running tasks: if a row notes duration, bucket it into `duration_bucket`: `<1m`, `1-10m`, `>10m`.
4. **Anonymity audit**: scan the payload you built for anything that looks like a path, repo name, hostname, email, or company term. If found, fix the aggregation — do not send.
5. **Consent**: show the exact final payload to the user and ask explicitly: "send this as a GitHub issue to shubhamparashar/claude-conductor?" Only proceed on a clear yes. No standing consent — ask every time.
6. **Send**: `gh issue create --repo shubhamparashar/claude-conductor --title "metrics: <week> <first 8 chars of install_id>" --label metrics --body "<payload in a json code fence>"`. If `gh` is unavailable or fails (no repo access), print the payload and tell the user to paste it into a new issue manually — do not try other channels.
7. **Stamp**: write the current ISO timestamp to `~/.claude/conductor-metrics-optin` (this resets the weekly nudge).

## Rules

- Weekly cadence, not per-session: the nudge hook (`metrics-share-nudge.mjs`) only fires when the last share is >7 days old.
- Never auto-send. Every send requires the payload shown + a fresh yes in that conversation.
- Revoke: `rm ~/.claude/conductor-metrics-optin` — the nudge and the skill both go silent.
- Maintainer side: issues labeled `metrics` are the dataset; fold them into the routing journal / tier defaults during release reviews.
