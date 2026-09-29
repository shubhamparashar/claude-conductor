import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'skills', 'cost-stats');

// USD per MTok from platform.claude.com/docs/en/about-claude/pricing:
// (input, output, cache hit, 5m cache write).
const OFFICIAL = {
    'claude-fable-5-1': [10, 50, 0.25, 12.5],
    'claude-fable-5': [10, 50, 1, 12.5],
    'claude-opus-5-5': [4, 20, 0.2, 5],
    'claude-opus-5': [5, 25, 0.5, 6.25],
    'claude-opus-4-1-20250805': [15, 75, 1.5, 18.75],
    'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
    'claude-sonnet-5': [2, 10, 0.2, 2.5],
    'claude-sonnet-4-6': [3, 15, 0.3, 3.75],
    'claude-haiku-4-5-20251001': [1, 5, 0.1, 1.25],
};
const FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

function pythonPrices() {
    const script = `
import json, sys
import costs
models = json.loads(sys.argv[1])
fields = ${JSON.stringify(FIELDS)}
print(json.dumps({m: [costs.price(m, {f: 1_000_000}) for f in fields] for m in models}))
`;
    const run = spawnSync('python3', ['-c', script, JSON.stringify(Object.keys(OFFICIAL))], {
        cwd: SKILL_DIR, encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
}

test('costs.py prices every current model at the official per-MTok rates', () => {
    const actual = pythonPrices();
    for (const [model, expected] of Object.entries(OFFICIAL)) {
        expected.forEach((usd, i) => {
            assert.ok(Math.abs(actual[model][i] - usd) < 1e-9, `${model} ${FIELDS[i]}: ${actual[model][i]} != ${usd}`);
        });
    }
});
