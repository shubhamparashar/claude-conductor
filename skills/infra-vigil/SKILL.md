---
name: infra-vigil
author: Shubham Parashar
description: 7-day 24/7 anomaly watch for any infra change or go-live (cutover, canary, resize, new service, traffic migration). Captures a baseline at go-live, then continuously compares live signals against it until an anomaly is found or 7 days pass - FLAG-only, it never reverts, commits, pushes, or mutates infra. Use when going live with an infra change ("start the vigil", "watch this rollout for a week"), and at the start of every session touching a task with an active vigil (re-arm a dead watcher).
---

# infra-vigil - baseline, watch 24/7 for a week, FLAG anomalies

Detection-only soak monitor. On anomaly it alerts with evidence and a
suggested quick-reversal recipe for the HUMAN to run - it never executes a
revert, never commits/pushes, never modifies infra. Safe for anyone to run.

## When this fires
1. **Go-live of any infra change**: traffic cutover/canary, compute migration,
   resize, new service/queue/cron, proxy-topology change, DB/pool changes.
2. **Session start, only if a `state.json` exists** in the state dir (see
   State) for a watch touching the current task. If it says active but the
   watcher is dead (session died, machine slept), RE-ARM it and tell the user
   in one line. No `state.json`, no trigger.

## State (survives sessions)
Per watch, in `.vigil/<name>/` (same convention as feature-vigil; NOT
committed to the repo - gitignore it): `state.json` (name, startedAt, endsAt =
start+7d, status, target identifiers, alert channel, lastCheckAt, checksRun,
anomalies[]), `baseline.json`, `log.md` (append-only: every check, anomaly,
re-arm, and gap). A vigil ends only when: anomaly confirmed (keep watching
unless the operator stops), 7 days pass (write closing summary), or the
operator says stop.

## Phase 1 - pre-flight angle checklist (BEFORE go-live)
Every angle below came from a real prod incident. Check each; a red blocks
the go-live (report it - do not fix infra yourself):
1. **IAM parity** - clone/new role gets `*` parity with the original, never an
   enumerated guess. Diff role policies before any traffic shift.
2. **Request semantics parity** - client IP (behind API GW/VPC-link/ALB, XFF
   carries only internal hops; parse RFC 7239 `Forwarded`), headers, auth
   context. Anything keyed on IP (rate limiter, geo) breaks silently.
3. **Capacity headroom** - size for BURST (parallel fan-outs from internal
   tools), not average. Lambda absorbs bursts by scaling; fixed fleets don't.
4. **Pool/connection limits** - DB pool max, acquire timeouts, app keep-alive
   > LB idle timeout.
5. **Crash surface** - process-level unhandledRejection/uncaughtException
   guards exist; fire-and-forget paths can't kill the process; aws-sdk v2
   request paths escape app error handling.
6. **Rollback lever** - identify the ONE reversible dial before go-live;
   verify one-way doors (e.g. API GW integration type can't change in place).
7. **Alarm coverage** - CPU, 5xx, task-crash alarms EXIST and page BEFORE the
   ramp, not after.
8. **Deploy-window drain** - graceful SIGTERM, dereg delay, slow_start;
   measure 5xx during a roll.
9. **Silent-failure plan** - errors that return empty instead of throwing
   never hit the error tracker; the baseline signature diff is what catches
   them.
10. **Background-job integrity** - enqueue/consume counts, not just HTTP 200s.

## Phase 2 - baseline capture (at go-live)
Save to `baseline.json`, each with the exact query used:
- CloudWatch: ELB/Target 5xx per hour (prior 24h), p50/p99 response time,
  CPU+mem avg/max, task/instance count.
- Your log store: ERROR count/hour, top-20 error body signatures with daily
  counts (filtered builder queries), key business-op throughput.
- Infra facts: task-def revision / version, listener weights, alarm list +
  states, role policy list.
- Alert-channel norms: P0 alerts/day in the paging channel for the prior week.

## Phase 3 - the watch (24/7 for 7 days)
Layered, most durable first:
1. **CloudWatch alarms -> SNS** (always; survives everything).
2. **Scheduled recurring check** - a scheduled task (the `schedule` skill or
   the scheduled-tasks tool). The check must VERIFY its alert delivery (parse
   the sender's success response - a connect is not a send).
3. **In-session waits** use Monitor (or a background task), not sleep loops;
   they die with the session, hence the re-arm rule.

Each check (one log.md line): last-hour 5xx, CPU max, running vs desired,
task stops with exit!=0 (ECS stopped-task data expires in ~1h - check EVERY
cycle, it cannot be backfilled), ERROR count vs baseline hour-of-day, NEW
error signatures not in the baseline top-20 (catches silent failures), >3x
jump in a known signature, new P0 alerts.

**Anomaly =** any of: 5xx > 3x baseline hour, CPU max > 85%, running <
desired, exit!=0 task stop, new signature > 100/h, known signature > 3x, new
P0 alert. **Trend-anomaly:** any signature growing >40%/day for 2+ days (a
real blowout grew 40-60%/day for 3 days before the P0 - the trend rule exists
to catch the next one on day 1).

## Phase 4 - on anomaly: FLAG, never act
1. Alert the operator on their configured channel (chat message, team pager,
   push service - whatever `state.json.alertChannel` says). Include: one-line
   anomaly, metric vs baseline evidence, first-seen time.
2. Include the suggested quick-reversal for the HUMAN (weight dial, previous
   task-def revision, flag off) - the vigil never runs it.
3. Record in log.md + state.json anomalies[]. Keep watching.
Never post to shared/team channels without an explicit ask; alerts go to the
operator who armed the vigil.

## Phase 5 - session re-arm protocol
If `state.json` is active and `lastCheckAt` is older than 2x the interval:
run one immediate catch-up check, re-arm the scheduled layer, log the gap
("watch gap 02:10-09:35, re-armed"). Gaps are honest data - never pretend
continuity.

## End of watch
Day 7 (or stop): closing summary in log.md - checks run, anomalies, gaps,
verdict (clean soak / issues found) - then surface the decisions that were
parked on the soak (e.g. a downsize review).
