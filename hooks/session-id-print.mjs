#!/usr/bin/env node
// SessionStart: print the session id so skills (goal-contract, handoff) can
// reference it without guessing. Never blocks; fails silent.
import { readFileSync } from 'node:fs';

try {
    const { session_id: sid } = JSON.parse(readFileSync(0, 'utf8'));
    if (sid) console.log(`session-id: ${sid}`);
} catch {}
