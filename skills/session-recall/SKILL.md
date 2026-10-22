---
name: session-recall
description: On-demand episodic memory — full-text search over ALL past Claude Code session transcripts, callable mid-task. Use when you need to recall how a past session solved something, what was decided in an earlier conversation, whether an error was seen before, or when the user asks "have we done this before", "search past sessions", "what did we decide about X", "recall".
---

# Session Recall

Past sessions are episodic memory sitting on disk (`~/.claude/projects/*/*.jsonl`). This skill searches them mid-task instead of relying on whatever a session-start hook happened to inject.

## Usage

```bash
python3 <skill-dir>/search.py search "migration dry run" --k 8
python3 <skill-dir>/search.py search "ERR_MODULE_NOT_FOUND" --project my-service
```

- Auto-indexes incrementally before every search (only new/changed transcripts; first run over a few hundred sessions takes ~30s, then it's instant).
- Returns ranked snippets with `session-id (project) role timestamp`.
- To pull full context from a hit: read the transcript file `~/.claude/projects/<project>/<session-id>.jsonl` selectively (grep around the match — these files are large), or suggest `claude --resume <session-id> --fork-session` to the user.

## When to reach for it

- Mid-task, before re-deriving something a past session likely solved (an error message, a config recipe, a decision).
- When the user references past work vaguely ("like we did last time", "that bug from last week").
- Before writing a new skill/memory — check whether a past session already documented the procedure.

Index lives at `~/.claude/session-index.db`; delete it to force a full rebuild. Top-level transcripts only (subagent transcripts are tool noise by volume).
