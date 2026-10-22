---
name: feature-vigil
author: Shubham Parashar
description: N-day log-sweep watch for a shipped PRODUCT/feature change (default 7 days) - baseline the feature's error signatures and business counters, then keep sweeping for signature growth, drops, throttling/rate-limiting, and silent failures; set up alerts for the feature and FLAG with evidence. Detection-only - never reverts, commits, pushes, or mutates infra. Use after shipping a feature/behavior change ("watch this feature for a week", "feature vigil on checkout", "sweep logs for N days").
---

# feature-vigil - baseline a feature's logs, sweep for N days, FLAG drift

Product-change counterpart to deploy-sentinel (single deploy) and an
infra-agnostic sibling of infra-vigil (infra go-lives). Scope here is ONE
feature/flow after a behavior change: is it erroring more, silently dropping
work, or getting throttled? Detection-only: on a finding it alerts the
operator with evidence and a suggested next step - it never reverts,
commits, pushes, or changes infra.

## Setup (once, at ship time)

Ask/derive from the change:
- **Feature surface**: the operations, resolvers, handlers, queues, and crons
  the change touches (build the list FROM THE DIFF or the feature spec).
- **Watch length**: N days (default 7).
- **Alert channel**: where the operator wants pings (chat, pager, push).
- **State dir** (`.vigil/<feature>/`, same convention as infra-vigil; survives sessions, NOT committed - gitignore it): `state.json` (feature,
  startedAt, endsAt, status, surfaces, alertChannel, lastSweepAt, sweepsRun,
  findings[]), `baseline.json`, `log.md` (append-only).

## Baseline (day 0)

Capture per surface, with the exact query used (use filtered builder
queries):
1. **Error signatures**: top-20 error bodies mentioning the feature's
   operations/files, daily counts for the prior 7 days.
2. **Throughput counters**: requests/executions per day for each operation -
   drops are invisible without a volume baseline.
3. **Business outcome counters**: the number that proves the feature works
   (orders placed, carts built, uploads completed, messages enqueued AND
   consumed). HTTP 200s are not outcomes.
4. **Throttle/rate-limit counters**: `Rate Limited`, `429`, `Throttl`,
   `TooManyRequests`, provider quota strings, SQS DLQ depth - for the feature
   path AND any third-party it calls.
5. **Drop indicators**: enqueue vs consume delta, `Failed to enqueue`,
   dead-letter counts, retry storms, timeout strings on the feature's queries.

## Sweeps (scheduled, every 1-6h for N days)

Scheduling follows infra-vigil (scheduled task as the durable layer, Monitor
for in-session waits, verify alert delivery). On any session touching the
feature, re-arm a dead watcher and log the gap.

Each sweep compares against the baseline hour/day-of-week where volumes are
cyclical:
- Error-signature counts: **known signature > 3x baseline**, or **any NEW
  signature > 100/h** that mentions the feature's ops/files.
- **Trend rule**: any signature growing >40%/day for 2+ days flags even if
  the absolute count is still small (real blowouts grow 40-60%/day for days
  before the P0).
- Throughput: operation volume **< 50% of baseline** for the time-of-day =
  possible silent drop/dead route.
- Outcome vs attempt divergence: attempts flat but outcomes falling =
  silent failure (empty-return paths never hit the error tracker).
- Throttling: rate-limit/429/quota counters **> 5x baseline**, or DLQ depth
  growing. Sample the keyed VALUE where the limiter keys on identity
  (RFC-1918 IPs where client IPs are expected = instant flag).

## Alerts to set up (day 0, with operator's go)

Create/propose durable alerts so the watch outlives any machine:
- Log-based alert (SigNoz/CloudWatch) on the feature's fatal signatures
  above threshold.
- Alert on the outcome counter dropping below floor.
- Alert on throttle counter / DLQ depth above ceiling.
Route to the team's paging channel. Creating ALERTS is in scope; changing
the feature, its config, or its infra is not.

## On a finding: FLAG, never act

1. Alert the operator: one-line finding, metric vs baseline evidence, query
   used, first-seen time.
2. Suggest the next step for the HUMAN (flag off, config change, revert PR,
   quota bump request) - never execute it.
3. Record in log.md + state.json findings[]. Keep watching until N days end
   or the operator stops the vigil.
Never post to shared channels without an explicit ask.

## End of watch

Closing summary in log.md: sweeps run, findings, gaps, verdict (clean /
issues). Surface any decision that was parked on the watch.
