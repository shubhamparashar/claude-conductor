#!/usr/bin/env node
// UserPromptSubmit hook: relays one-shot flags dropped by the Stop hooks
// (post-task reflection, unchecked goal contract). Pure relay - no counters,
// no per-prompt writes, silent unless a flag file exists.
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let sid = 'unknown';
try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    sid = input.session_id || 'unknown';
} catch {}

// Post-task reflection flag dropped by the Stop hook when the previous turn
// used heavy tooling - fire once, then clear the flag.
const reflectFlag = join(tmpdir(), `conductor-reflect-${sid}`);
let toolCount = null;
try { toolCount = readFileSync(reflectFlag, 'utf8').trim(); unlinkSync(reflectFlag); } catch {}

if (toolCount !== null) {
    console.log(
        `<system-reminder>Post-task reflection: the previous turn used ${toolCount} tool calls. If it solved a problem via a reusable PROCEDURE not already covered by an existing skill, draft it as a skill now (or add the recipe to your knowledge base). If an EXISTING skill or memory proved wrong or stale during that task, patch it now. If neither applies, continue without comment.</system-reminder>`
    );
}

// Goal-contract flag dropped by the Stop hook (goal-contract-gate.mjs) when
// an ACTIVE contract still has unchecked completion criteria - fire once.
const contractFlag = join(tmpdir(), `conductor-goal-contract-${sid}`);
let contractInfo = null;
try { contractInfo = readFileSync(contractFlag, 'utf8').trim(); unlinkSync(contractFlag); } catch {}

if (contractInfo !== null) {
    const [path, unchecked] = contractInfo.split('|');
    console.log(
        `<system-reminder>Goal contract: ${unchecked} unchecked completion criteria remain in ${path}. Before declaring the task done, reopen the contract, paste real evidence against each box, and only check boxes the evidence actually supports. Report any criterion you can't check as NOT done.</system-reminder>`
    );
}
