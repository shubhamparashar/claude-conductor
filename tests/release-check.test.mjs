import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('scripts/release-check.sh reports clean', () => {
    const result = spawnSync('bash', [join(REPO_ROOT, 'scripts', 'release-check.sh')], {
        encoding: 'utf8',
        cwd: REPO_ROOT,
    });
    assert.match(result.stdout, /release-check: clean/, `stderr: ${result.stderr}`);
    assert.equal(result.status, 0);
});
