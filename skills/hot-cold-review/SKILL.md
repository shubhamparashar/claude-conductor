---
name: hot-cold-review
description: Review a PR or diff with two independent agents at once — a "hot" reviewer primed with full context (the ERD/spec, related merged PRs, this session's state, known collisions) and a "cold" reviewer with fresh eyes (only the diff, the repo, and the spec — no priming). Findings that BOTH raise are high-confidence; a collision/spec-gap only one catches still surfaces. Use when the user says "hot cold", "hot/cold review", "dual review this PR", or wants two independent perspectives on a change before merge.
---

# /hot-cold-review — two independent reviewers, one PR

Two agents review the same change from opposite ends of the context spectrum, in parallel, read-only. Agreement between them is the signal; disagreement is where you look harder. Usable standalone on any PR/branch/diff.

## Inputs to gather first (main loop, before spawning)

- **The change**: `gh pr diff <N>` (or a diff range). Get the changed file list too.
- **The spec**: the ERD / PRD / issue the PR implements. If the PR body names `docs/erd/*.md`, read it fully — it is the source of truth for *spec* findings. Fetch the exact version the user points at if they give a link.
- **Context the hot reviewer needs and the cold one must NOT get**: related PRs already merged (especially any that touch the same table/module — migration collisions live here), this session's known bugs/fixes, dormancy/flag requirements, prod/staging state. Write this down; it's the ONLY thing that differs between the two prompts.

## Spawn both in parallel, background

Both get: the PR number, the spec file path, "read-only, do not post anything anywhere", and "return findings most-severe-first: file:line + snippet, one-sentence defect, concrete failure scenario, severity (blocker/should-fix/nit); end with a one-line SHIP/HOLD verdict."

- **HOT** — `model: opus`, high effort. Give it the full context bundle above: related merged PRs by name, the collision hypothesis to verify end-to-end, dormancy priors, session history. Its job is spec compliance (cross-check every column/index/field the ERD demands against what the PR actually does) + context-dependent bugs (collisions, "already shipped elsewhere", flag interactions) a fresh reviewer can't see. High-stakes context judging → top tier.
- **COLD** — `model: sonnet`. Give it ONLY the diff + repo + spec. NO related-PR names, NO session context, NO hints about where bugs are. Instead, instruct it to *earn* the same findings independently: e.g. for migrations, "grep `services/migrations/` for other files touching the same table/column/index; read the migration runner; determine what happens if two migrations both make this change and one already ran." If cold reaches the collision on its own, that's the strongest possible confirmation.

Route by stakes: a prod-migration / money / auth PR justifies opus for hot. A small refactor can drop both a tier. Don't delegate the final synthesis — that's the main loop's job (below).

## Synthesize (main loop — never delegated)

When both land, merge — don't just concatenate:

- **Confirmed** — raised by both (or by one and you verified it yourself). Rank these first; these are the merge blockers.
- **Hot-only** — usually spec gaps / collisions the cold reviewer had no way to know. Verify the context is real before trusting.
- **Cold-only** — usually local correctness the hot reviewer skimmed past while chasing context. Fresh eyes catch what priming hides.
- Drop anything you can disprove by reading the code yourself. Put verification method in chat, not in the report ("confirmed by reading X:42"), never "verified by 2 agents" fluff in a PR.

Report as a side-by-side: one blockers list (confirmed first), then hot-only, then cold-only, then a single SHIP/HOLD with the reason. Evidence (file:line) on every claim.

## Guardrails

- **Read-only.** Neither agent nor this skill posts to GitHub/Slack/anywhere, comments on the PR, or edits code. Output is for the human. Posting a review comment is a separate, explicitly-requested boundary action.
- **The context asymmetry is the whole point** — if you give both agents the same context, you've just run the same review twice. Keep the cold prompt clean.
