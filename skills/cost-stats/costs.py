#!/usr/bin/env python3
"""Token/cost accounting from Claude Code transcripts (main + subagents).

Aggregates per-message `usage` by model, project, and day; prices with the
public API rates as an upper-bound equivalent (subscription usage doesn't
bill per token - the $ column shows what the traffic would cost on the API,
which is the right number for routing decisions).

Usage:
  costs.py [--days 7] [--project <slug-substring>] [--by day|project|model]
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECTS = Path.home() / '.claude' / 'projects'
# $ per MTok: (input, output, cache_read, cache_write_5m)
# Keep in sync with DEFAULT_PRICING in ~/repo/cc-orchestrator/lib/pricing.mjs - both
# tables hardcode the same public API rates and drift silently if only one is updated.
PRICES = {
    'haiku': (1.00, 5.00, 0.10, 1.25),
    'sonnet': (3.00, 15.00, 0.30, 3.75),
    'sonnet-5': (2.00, 10.00, 0.20, 2.50),
    'opus': (5.00, 25.00, 0.50, 6.25),
    'opus-4-1': (15.00, 75.00, 1.50, 18.75),
    'opus-5-5': (4.00, 20.00, 0.20, 5.00),
    'fable': (10.00, 50.00, 1.00, 12.50),
    'fable-5-1': (10.00, 50.00, 0.25, 12.50),
    'mythos': (10.00, 50.00, 1.00, 12.50),
    'mythos-5-1': (10.00, 50.00, 0.25, 12.50),
}
USAGE_RE = re.compile(r'"model":"([^"]+)".*?"usage":\{([^}]*)')
FIELD_RE = re.compile(r'"(input_tokens|output_tokens|cache_read_input_tokens|cache_creation_input_tokens)":(\d+)')
TS_RE = re.compile(r'"timestamp":"(\d{4}-\d{2}-\d{2})')


_WARNED_UNPRICED = set()


def price(model, u):
    # Longest matching key wins, so a model-specific rate ('opus-4-1') beats the
    # generic tier ('opus') regardless of declaration order.
    key = max((k for k in PRICES if k in model), key=len, default=None)
    if key is None:
        # An unpriced model costs $0, which is indistinguishable from a free
        # session - say so once rather than reporting a silently wrong total.
        # '<synthetic>' and friends are harness placeholders for injected turns,
        # not billable API calls, so $0 is correct and needs no warning.
        if not model.startswith('<') and model not in _WARNED_UNPRICED:
            _WARNED_UNPRICED.add(model)
            print(f'warning: no price for {model}; its usage is counted as $0', file=sys.stderr)
        return 0.0
    tier = PRICES[key]
    i, o, cr, cw = tier
    return (u.get('input_tokens', 0) * i + u.get('output_tokens', 0) * o
            + u.get('cache_read_input_tokens', 0) * cr
            + u.get('cache_creation_input_tokens', 0) * cw) / 1e6


def main():
    days, project, by = 7, None, 'model'
    it = iter(sys.argv[1:])
    for a in it:
        if a == '--days':
            days = int(next(it))
        elif a == '--project':
            project = next(it)
        elif a == '--by':
            by = next(it)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%d')

    agg = {}
    for path in PROJECTS.rglob('*.jsonl'):
        proj = path.relative_to(PROJECTS).parts[0]
        if project and project not in proj:
            continue
        if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime('%Y-%m-%d') < cutoff:
            continue
        with open(path, errors='replace') as f:
            for line in f:
                if '"usage"' not in line:
                    continue
                m = USAGE_RE.search(line)
                if not m:
                    continue
                date = (TS_RE.search(line) or [None, '?'])[1]
                if date != '?' and date < cutoff:
                    continue
                u = {k: int(v) for k, v in FIELD_RE.findall(m.group(2))}
                key = {'day': date, 'project': proj, 'model': m.group(1)}[by]
                row = agg.setdefault(key, {'msgs': 0, 'in': 0, 'out': 0, 'cache_r': 0, 'usd': 0.0})
                row['msgs'] += 1
                row['in'] += u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
                row['out'] += u.get('output_tokens', 0)
                row['cache_r'] += u.get('cache_read_input_tokens', 0)
                row['usd'] += price(m.group(1), u)

    if not agg:
        print('no usage found')
        return
    print(f'{by:<42} {"msgs":>6} {"in-tok":>10} {"cache-rd":>12} {"out-tok":>10} {"api-$":>8}')
    for key, r in sorted(agg.items(), key=lambda kv: -kv[1]['usd']):
        print(f'{key[:42]:<42} {r["msgs"]:>6} {r["in"]:>10,} {r["cache_r"]:>12,} {r["out"]:>10,} {r["usd"]:>8.2f}')
    total = sum(r['usd'] for r in agg.values())
    print(f'{"TOTAL (API-equivalent)":<42} {"":>6} {"":>10} {"":>12} {"":>10} {total:>8.2f}')


if __name__ == '__main__':
    main()
