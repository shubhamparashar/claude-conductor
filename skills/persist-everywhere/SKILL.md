---
name: persist-everywhere
description: Broadcast a fact, rule, or preference to ALL of the user's knowledge surfaces at once — their knowledge base, auto-memory, global ~/.claude/CLAUDE.md, and (when project-relevant) project CLAUDE.md files. Use when the user says "save this everywhere", "add to memory and CLAUDE.md", "persist this everywhere", or "save this in all places".
---

# Persist Everywhere

Take the fact/rule/preference from the conversation (the thing the user just said "add this" about — if ambiguous, the most recent decision or correction discussed) and write it to every applicable surface in one pass. One canonical deep copy; everything else is a pointer or condensed restatement. Never paste the same full text into four places — that guarantees drift.

## Surfaces and what goes where

1. **Knowledge base (canonical copy)** — the user's structured notes system, if they have one (an Obsidian vault, OKF bundle, wiki directory — check memory/CLAUDE.md for where it lives). Find the existing concept/note that covers the topic and UPDATE it; do not create a duplicate. Append a dated one-liner to the base's changelog if it keeps one. If the user has no knowledge base, the memory directory is the canonical copy instead.
2. **Global CLAUDE.md** — `~/.claude/CLAUDE.md`. Only for cross-project working rules (how the agent should behave everywhere). If the file is an index of pointer one-liners (see the slim-claude-md skill), add/update the one-liner AND the detail file it points to. If a section on the topic exists, edit it instead of appending a new one.
3. **Auto-memory** — the session's memory directory. One file per fact with the standard frontmatter, plus a one-line pointer in `MEMORY.md`. Update an existing memory file if one covers the topic; delete memories the new fact contradicts.
4. **Project CLAUDE.md(s)** — only when the user explicitly says "all the claude mds" or the fact is project-specific. Default to the current repo's CLAUDE.md; ask before touching other repos' checked-in CLAUDE.md files (team-visible, needs a commit to ship).

## Rules

- **Verdict gate before any write** — run this checklist first and state the verdict in one line:
  1. Grep existing coverage: the knowledge base, memory index + files, rules, and existing skills.
  2. Decide scope: cross-project rule vs project-only vs domain.
  3. Verdict: **Save** (new — write it) · **Improve** (existing entry stale/partial — update in place) · **Absorb** (belongs inside an existing rule/concept — merge, no new file) · **Drop** (already fully covered — write nothing, point to the existing coverage).
  Only Save/Improve/Absorb proceed; Drop ends the skill.
- **Dedupe before writing**: on every surface, search for existing coverage first; edit in place rather than appending a second copy.
- **Condense per surface**: knowledge base gets the full reasoning; CLAUDE.md gets the actionable rule; memory gets fact + why + how-to-apply; project CLAUDE.md gets only the project-relevant slice.
- **Cross-link**: each copy names where the canonical copy lives.
- **Report back** one line per surface: `surface — file — created/updated/skipped(reason)`.
- Skip a surface (and say so) when the fact doesn't belong there.
- Checked-in project CLAUDE.md edits are working-tree only; never commit/push without an explicit ask.
