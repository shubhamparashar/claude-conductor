#!/usr/bin/env node
// SubagentStop: append a PENDING row per completed subagent to
// ~/.claude/routing-journal-pending.md - model, task description, token spend.
// Rows carry no outcome judgment; the model-router skill promotes them into
// ~/.claude/routing-journal.md with an honest outcome, or discards them.
// Silent, best-effort: never blocks the session on any error.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PENDING = join(homedir(), '.claude', 'routing-journal-pending.md');
const SEEN = join(homedir(), '.claude', '.delegation-journal-seen');

try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const dir = join(
        input.transcript_path?.replace(/\.jsonl$/, '') || '',
        'subagents'
    );
    if (!existsSync(dir)) process.exit(0);

    // SEEN rows are "<name>\t<YYYY-MM-DD>"; legacy undated rows get stamped on
    // first rewrite. Same 14-day cap as PENDING so the dedup set can't grow
    // unbounded - a transcript older than that is never re-scanned anyway.
    const seenCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const stamp = new Date().toISOString().slice(0, 10);
    const seen = new Map();
    if (existsSync(SEEN)) {
        for (const line of readFileSync(SEEN, 'utf8').split('\n')) {
            if (!line) continue;
            const [name, seenDate] = line.split('\t');
            const d = seenDate || stamp;
            if (d >= seenCutoff) seen.set(name, d);
        }
    }
    const rows = [];
    for (const f of readdirSync(dir)) {
        if (!f.endsWith('.meta.json') || seen.has(f)) continue;
        seen.set(f, stamp);
        let meta = {};
        try { meta = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch {}
        const jsonl = join(dir, f.replace('.meta.json', '.jsonl'));
        let model = '?', outTokens = 0, inTokens = 0;
        try {
            for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
                const mm = line.match(/"model":"([^"]+)"/);
                if (mm) model = mm[1];
                const um = line.match(/"output_tokens":(\d+)/);
                if (um) outTokens += parseInt(um[1], 10);
                // true in-context input = fresh + cache-read + cache-creation;
                // "input_tokens" alone is only the uncached marginal slice
                const im = line.match(/"input_tokens":(\d+)/);
                if (im) inTokens += parseInt(im[1], 10);
                const cr = line.match(/"cache_read_input_tokens":(\d+)/);
                if (cr) inTokens += parseInt(cr[1], 10);
                const cc = line.match(/"cache_creation_input_tokens":(\d+)/);
                if (cc) inTokens += parseInt(cc[1], 10);
            }
        } catch {}
        const date = (input.ts || new Date().toISOString()).slice(0, 10);
        const desc = (meta.description || meta.agentType || 'subagent').replace(/\|/g, '/').slice(0, 80);
        // no usage record at all = the agent never got a first API response;
        // journal it as its own failure mode, not as a judgeable PENDING row
        const outcome = model === '?' && inTokens + outTokens === 0
            ? 'SPAWN-FAILED'
            : `PENDING (~${inTokens} in / ~${outTokens} out tok)`;
        rows.push(`| ${date} | ${desc} | ${model} | 1 | ${outcome} | auto-captured; judge & promote via model-router |`);
    }
    if (rows.length) {
        const header = '# Pending delegation rows (auto-captured by delegation-journal hook)\n' +
            'Promote honest outcomes into routing-journal.md via the model-router skill, then delete the row.\n\n' +
            '| date | task | model | n | outcome | note |\n|---|---|---|---|---|---|\n';
        // Age cap: drop rows older than 14 days on every append so the pending
        // file doesn't grow unbounded. Promotion logic is untouched - this only
        // prunes rows nobody has triaged in two weeks.
        const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        let keptRows = [];
        if (existsSync(PENDING)) {
            keptRows = readFileSync(PENDING, 'utf8').split('\n').filter((line) => {
                const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|/);
                return m && m[1] >= cutoff;
            });
        }
        writeFileSync(PENDING, header + [...keptRows, ...rows].join('\n') + '\n');
        writeFileSync(SEEN, [...seen].map(([n, d]) => `${n}\t${d}`).join('\n') + '\n');
    }
} catch {}
