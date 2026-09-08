import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOKS_DIR = join(REPO_ROOT, 'hooks');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures');

// A fresh, isolated HOME/TMPDIR/project dir per call so a hook never touches
// the real ~/.claude or reads state left by a previous test.
function makeSandbox() {
    const home = mkdtempSync(join(tmpdir(), 'conductor-test-home-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    const projectDir = mkdtempSync(join(tmpdir(), 'conductor-test-project-'));
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    writeFileSync(join(projectDir, '.claude', 'settings.json'), '{}\n');
    return { home, projectDir };
}

// Fill __PROJECT_DIR__ / __FIXTURES_DIR__ placeholders in a fixture object.
function hydrate(obj, projectDir) {
    const json = JSON.stringify(obj)
        .replaceAll('__PROJECT_DIR__', projectDir)
        .replaceAll('__FIXTURES_DIR__', FIXTURES_DIR);
    return JSON.parse(json);
}

function loadFixture(name, projectDir) {
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8'));
    return hydrate(raw, projectDir);
}

// Runs a hook script exactly the way the harness does: stdin = JSON payload,
// argv = whatever hooks.json passes after ${CLAUDE_PLUGIN_ROOT} expansion.
function runHook(scriptPath, payload, { home, projectDir, extraArgs = [], extraEnv = {} }) {
    const result = spawnSync('node', [scriptPath, ...extraArgs], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        cwd: projectDir,
        env: {
            PATH: process.env.PATH,
            HOME: home,
            TMPDIR: home,
            CLAUDE_PLUGIN_ROOT: REPO_ROOT,
            CLAUDE_PROJECT_DIR: projectDir,
            ...extraEnv,
        },
    });
    return result;
}

// stdout must be empty, or parse as JSON, or otherwise be plain text (hooks
// here only ever emit plain informational strings, never malformed output).
function assertValidOutput(stdout) {
    if (stdout.trim() === '') return;
    try {
        JSON.parse(stdout);
    } catch {
        assert.ok(typeof stdout === 'string', 'stdout must be plain text if not JSON');
    }
}

// ── Generic pass: every hook registered in hooks.json, run once against its
// fixture, must exit 0 with well-formed stdout. ──
const hooksManifest = JSON.parse(readFileSync(join(HOOKS_DIR, 'hooks.json'), 'utf8'));
const registeredHooks = [];
for (const groups of Object.values(hooksManifest.hooks)) {
    for (const group of groups) {
        for (const h of group.hooks) {
            const tokens = h.command
                .replaceAll('${CLAUDE_PLUGIN_ROOT}', REPO_ROOT)
                .split(/\s+/);
            const scriptPath = tokens[1];
            const extraArgs = tokens.slice(2).map((t) => t.replaceAll('${CLAUDE_PLUGIN_ROOT}', REPO_ROOT));
            registeredHooks.push({ scriptPath, extraArgs, name: basename(scriptPath, extname(scriptPath)) });
        }
    }
}

for (const { scriptPath, extraArgs, name } of registeredHooks) {
    test(`${name}: fixture run exits 0 with well-formed stdout`, () => {
        const { home, projectDir } = makeSandbox();
        const payload = loadFixture(name, projectDir);
        const result = runHook(scriptPath, payload, { home, projectDir, extraArgs });
        assert.equal(result.status, 0, `stderr: ${result.stderr}`);
        assertValidOutput(result.stdout);
    });
}

// ── Targeted assertions ──

test('model-routing-context.mjs: emits the long ladder when no rules dir exists', () => {
    const { home, projectDir } = makeSandbox();
    const payload = loadFixture('model-routing-context', projectDir);
    const result = runHook(join(HOOKS_DIR, 'model-routing-context.mjs'), payload, { home, projectDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Delegation ladder for spawned agents/);
});

test('model-routing-context.mjs: emits a short pointer (<300 bytes) when model-routing.md exists', () => {
    const { home, projectDir } = makeSandbox();
    const rulesDir = join(home, '.claude', 'rules-detail');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'model-routing.md'), '# stub\n');
    const payload = loadFixture('model-routing-context', projectDir);
    const result = runHook(join(HOOKS_DIR, 'model-routing-context.mjs'), payload, { home, projectDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /conductor-model-routing/);
    assert.ok(result.stdout.length < 300, `expected <300 bytes, got ${result.stdout.length}`);
});

test('memory-nudge.mjs: writes no files in TMPDIR', () => {
    const { home, projectDir } = makeSandbox();
    const before = readdirSync(home);
    const payload = loadFixture('memory-nudge', projectDir);
    const result = runHook(join(HOOKS_DIR, 'memory-nudge.mjs'), payload, { home, projectDir });
    assert.equal(result.status, 0);
    const after = readdirSync(home);
    assert.deepEqual(after, before, 'memory-nudge.mjs must not create files under TMPDIR');
});

test('conductor-doctor.mjs: flags hook-refs for a missing script, then RESOLVED once it exists', () => {
    const { home, projectDir } = makeSandbox();
    const missingScript = join(projectDir, 'scripts', 'my-custom-hook.sh');
    writeFileSync(
        join(projectDir, '.claude', 'settings.json'),
        JSON.stringify({
            hooks: {
                Stop: [{ hooks: [{ type: 'command', command: `bash \${CLAUDE_PROJECT_DIR}/scripts/my-custom-hook.sh` }] }],
            },
        }),
    );
    const payload = loadFixture('conductor-doctor', projectDir);

    const first = runHook(join(HOOKS_DIR, 'conductor-doctor.mjs'), payload, {
        home, projectDir, extraArgs: [REPO_ROOT],
    });
    assert.equal(first.status, 0);
    assert.match(first.stdout, /hook-refs/);
    const reportPath = join(home, '.claude', 'conductor-report.md');
    assert.ok(existsSync(reportPath), 'expected a conductor-report.md to be written');
    let report = readFileSync(reportPath, 'utf8');
    assert.match(report, /\[OPEN\] hook-refs/);

    mkdirSync(dirname(missingScript), { recursive: true });
    writeFileSync(missingScript, '#!/usr/bin/env bash\necho ok\n');

    const second = runHook(join(HOOKS_DIR, 'conductor-doctor.mjs'), payload, {
        home, projectDir, extraArgs: [REPO_ROOT],
    });
    assert.equal(second.status, 0);
    report = readFileSync(reportPath, 'utf8');
    assert.match(report, /\[RESOLVED\] hook-refs/);
});

test('delegation-journal.mjs: prunes SEEN rows older than 14 days', () => {
    const { home, projectDir } = makeSandbox();
    mkdirSync(join(home, '.claude'), { recursive: true });
    const seenPath = join(home, '.claude', '.delegation-journal-seen');
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    writeFileSync(seenPath, `stale-entry.meta.json\t${oldDate}\nrecent-entry.meta.json\t${recentDate}\n`);

    const payload = loadFixture('delegation-journal', projectDir);
    const result = runHook(join(HOOKS_DIR, 'delegation-journal.mjs'), payload, { home, projectDir });
    assert.equal(result.status, 0);

    const seenAfter = readFileSync(seenPath, 'utf8');
    assert.ok(!seenAfter.includes('stale-entry.meta.json'), 'a >14-day-old SEEN row must be pruned');
    assert.ok(seenAfter.includes('recent-entry.meta.json'), 'a recent SEEN row must survive');
});

test('post-task-reflect.mjs: a missing transcript_path exits 0 with no output', () => {
    const { home, projectDir } = makeSandbox();
    const result = runHook(join(HOOKS_DIR, 'post-task-reflect.mjs'), { session_id: 't', transcript_path: join(home, 'nope.jsonl') }, { home, projectDir });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
});
