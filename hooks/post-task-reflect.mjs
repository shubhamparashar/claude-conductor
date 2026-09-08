#!/usr/bin/env node
// Stop hook: Hermes-style immediate post-task reflection trigger. When the
// turn that just ended used >= CONDUCTOR_REFLECT_MIN_TOOLS tool calls
// (default 8), drop a flag; the memory-nudge UserPromptSubmit hook injects a
// skill-reflection reminder on the NEXT prompt (Stop-hook stdout is not shown
// to the model, so the flag file is the only reliable channel).
import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

const MIN_TOOLS = parseInt(process.env.CONDUCTOR_REFLECT_MIN_TOOLS || '8', 10);

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch {}
const { transcript_path: transcript, session_id: sid } = input;
if (!transcript || !sid) process.exit(0);

const isRealUserMsg = (e) => {
    if (e.type !== 'user') return false;
    const c = e.message?.content;
    if (typeof c === 'string') return true;
    return Array.isArray(c) && c.some(p => p?.type === 'text');
};

let count = 0;
const stream = createReadStream(transcript);
stream.on('error', () => process.exit(0));
const rl = readline.createInterface({ input: stream });
rl.on('line', (line) => {
    let e;
    try { e = JSON.parse(line); } catch { return; }
    if (isRealUserMsg(e)) { count = 0; return; }
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
        count += e.message.content.filter(p => p?.type === 'tool_use').length;
    }
});
rl.on('close', () => {
    if (count >= MIN_TOOLS) {
        try { writeFileSync(join(tmpdir(), `conductor-reflect-${sid}`), String(count)); } catch {}
    }
});
