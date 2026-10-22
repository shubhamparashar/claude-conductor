---
name: goal-contract
description: Define "done" and the evidence that proves it BEFORE work starts, then refuse to declare the task done until every criterion is checked off with pasted evidence. Use when the user says "goal contract", "define done", "contract this task", or before a multi-step task where "done" could otherwise be argued after the fact.
---

# Goal Contract

Write down what "done" means before touching any code, so completion is checked against a contract instead of a vibe. Modeled on hermes-agent's `/goal` completion contracts.

## When to use

Any task with more than one deliverable, a merge/deploy boundary, or a history of "done" turning out to mean "mostly done" — new features, migrations, multi-file refactors, anything with a PR at the end. Skip it for a single-file typo fix; the contract overhead isn't worth it.

## Write the contract (before work starts)

Create `~/.claude/goal-contracts/<slug>.md` (slug = short kebab-case task name; include the session id in frontmatter so the gate hook can match it; the SessionStart hook prints it as `session-id: <id>` at the top of the session):

```markdown
---
status: ACTIVE
session_id: <current session id>
created: <ISO timestamp>
---
# Goal: <one line, what "done" means>

## Completion Criteria
- [ ] <criterion 1>
  Evidence: <exact command output, file:line, test pass line, or URL that will prove this>
- [ ] <criterion 2>
  Evidence: <...>

## Non-Goals
- <explicitly out of scope, so scope creep doesn't get counted as "still not done">
```

Each criterion must name its evidence *type* up front — "tests pass" is not evidence, "`yarn test:unit foo.test.ts` → `12 passed`" is. If you can't say what evidence would prove a criterion, the criterion is too vague — rewrite it.

## Close the contract (before reporting done)

Before saying the task is complete, reopen the contract file and, for each box:

1. Re-run or re-check the thing the evidence line names.
2. Paste the actual evidence next to the criterion (real output, not a paraphrase).
3. Check the box only if the evidence is there and it actually satisfies the criterion.

Any box you can't check stays unchecked — report the task as **NOT done**, list the unfinished criteria and why, and stop. Do not soften an unchecked box into "mostly done" or "should be fine." Set `status: DONE` in the frontmatter only when every box is checked.

## Guardrails

- One contract file per task; don't let contracts pile up — set `status: DONE` (or delete) when finished so the Stop-hook gate (`hooks/goal-contract-gate.mjs`) stops tracking it.
- The contract is a discipline device for you, not paperwork for the user — keep it terse, don't narrate it in chat unless asked.
- If the user's ask changes mid-task, edit the contract's criteria to match — don't silently reinterpret "done" against the old contract.
