---
name: facts-recall
description: Semantic-knowledge search — FTS5 index over the distilled knowledge layer (auto-memory files, ~/.claude/rules, and configured knowledge bundles like OKF), chunked by heading. Use when you need a precise fact, decision, or rule from persisted knowledge ("what do we know about X", "which rule covers Y", "search the bundles/memory"), as the queryable complement to session-recall's transcript search.
---

# Facts Recall

Session-recall searches episodic memory (raw transcripts). This searches the semantic layer — the distilled facts those sessions wrote down: auto-memory files, `~/.claude/rules/*.md`, and any knowledge-bundle directories (e.g. OKF bundles). Structured, queryable recall over knowledge beats replaying transcripts: hits land on the exact concept section, not a 2000-char conversation snippet.

## Usage

```bash
python3 <skill-dir>/facts.py search "payment retry policy" --k 8
CONDUCTOR_KNOWLEDGE_DIRS=~/repo/context/okf python3 <skill-dir>/facts.py search "release checklist"
```

- Indexed by default: `~/.claude/rules/` and every `~/.claude/projects/*/memory/`.
- Add bundle roots via `CONDUCTOR_KNOWLEDGE_DIRS` (colon-separated); set it in your shell profile or settings `env` so it applies everywhere.
- Auto-indexes incrementally before every search (mtime-based); deleted files fall out of the index automatically.
- Hits print `path § heading` — Read the file section for full context.

## When to reach for it

- Before broad grep sweeps over memory/bundle directories.
- When a question is about a persisted fact/decision/rule rather than "how did a past session do this" (that's session-recall).
- Before writing a new memory — check whether the fact already exists (dedupe-first).

Index lives at `~/.claude/facts-index.db`; delete it to force a full rebuild.
