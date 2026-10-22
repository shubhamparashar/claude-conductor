---
name: learn
description: Distill a reusable skill RIGHT NOW from what this session just did (or from a directory, file, or URL you point at), and write it to the drafts lane for review. Use when the user says "/learn", "turn that into a skill", "remember how we did this", "make this repeatable", or right after solving something multi-step that will recur.
---

# Learn

The nightly harvest (an optional job; setup in `examples/skill-harvest/`, not installed by default) finds procedures by re-reading yesterday's transcripts. This does it in-session, where the context is still live and free: you already know which step was the gotcha and which was noise. Same output lane, same review gate.

## What to distill

A procedure worth a skill is one that (a) took several steps to get right, (b) another session could follow verbatim, and (c) hit at least one gotcha that isn't obvious from the docs. If the answer was a single command or a one-off lookup, say so and write nothing. A drafts dir full of trivia is worse than an empty one.

Sources, in order of preference:

- **This session** (default, no argument): the task just completed. Use your own context, don't re-read the transcript.
- **A path** (`/learn ./scripts/deploy`): read the code/docs there and distill the operating procedure, not an API dump.
- **A URL**: fetch it, then write the procedure as it applies *here*, with the local specifics filled in.

## Before writing: overlap check

Grep `~/.claude/skills/`, the project's `.claude/skills/` and `.claude/commands/`, and the plugin skills for the concept. Existing skill covers 80% of it? **Patch that skill instead**: write the proposed change to `~/.claude/skills-drafts/patches/<skill-name>-<date>.md` as three headed sections: `## What failed` (the observed failure or gap, quoted), `## Root cause` (why the skill allowed it), `## Proposed patch` (a concrete diff against the live `SKILL.md`). Duplicated skills are the main way a skills dir rots.

## Write it

Write to `~/.claude/skills-drafts/<kebab-name>/SKILL.md`:

```markdown
---
name: <kebab-name>
description: <what it does> Use when <trigger phrases the user would actually type>.
---
```

Then the procedure: the steps in order, the gotchas that cost time in this session, and the check that proves it worked. Keep it short. A skill nobody finishes reading is a skill nobody follows.

**Never write into `~/.claude/skills/` or a project's `.claude/skills/`.** Drafts don't auto-activate; promotion is a human move (`mv ~/.claude/skills-drafts/<name> ~/.claude/skills/`). Print the draft path and that command when done.
