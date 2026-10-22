---
name: deploy-sentinel
author: Shubham Parashar
description: Safe deploy watcher - watch CI, prove the deployed artifact, baseline + sweep logs/metrics after a merge, and FLAG problems with evidence plus a ready-to-run reversal recipe. Detection-only - it never reverts, commits, pushes, or mutates infra. Use after merging any prod-touching change ("watch this deploy", "deploy sentinel", "babysit the deploy - flag only").
---

# /deploy-sentinel - deploy, observe, FLAG (never revert)

Detection-only deploy guard. It does everything a deploy babysitter should -
CI watch, artifact proof, baselined log sweeps, blast-radius fan-out - and when
something is wrong it STOPS and reports: the evidence, the attribution check,
and the exact reversal command the human can run. It never executes a revert,
never commits/pushes, never modifies infra. That keeps it safe for anyone on
the team to run on any deploy.

## 1. Baseline BEFORE the deploy lands

Capture the pre-deploy error floor so post-deploy numbers mean something. It
must be captured before the merge; if invoked after, use the 30 minutes before
the deploy time. Take the region and log group from the repo/diff (SST/CDK
stack, task definition), not from memory:

```bash
LG="/aws/lambda/<function-log-group>"   # or /ecs/<cluster> for Fargate surfaces
REGION="<region from the stack config>"
FATAL='<fatal classes for this stack>'   # see the example below
QID=$(aws logs start-query --region "$REGION" --log-group-name "$LG" \
  --start-time $(($(date +%s)-1800)) --end-time $(date +%s) \
  --query-string "filter @message like /$FATAL/ | stats count() as fatal" \
  --query queryId --output text)
until [ "$(aws logs get-query-results --region "$REGION" --query-id "$QID" \
  --query status --output text)" = Complete ]; do sleep 2; done
aws logs get-query-results --region "$REGION" --query-id "$QID"
```

Use fatal classes only - a broad `/error/i` regex is noise on high-traffic
surfaces. Example (Node Lambda on SST), adapt to your stack:

```
FATAL='ERR_MODULE_NOT_FOUND|Runtime.ImportModuleError|Runtime.UserCodeSyntaxError|Unhandled Promise|Task timed out|Process exited before completing|Cannot find module|Please make sure it is bound|Failed to enqueue'
```

Also record: invoke rate (`filter @type="REPORT" | stats count()`), and for
canary/route work the current API GW integration
(`aws apigatewayv2 get-integration ...` - Lambda AWS_PROXY vs ALB VPC_LINK).

## 2. Watch CI + prove artifact + smoke

- Find the run by merge SHA, `gh run watch` in background.
- Prove the ARTIFACT, not the run status: download the deployed bundle (or
  pull the live image tag / task-def revision) and `grep -a` for a marker from
  the diff. CI "success" with a stale artifact is a known failure mode here.
- Smoke the surface with explicit status assert (`curl -w "%{http_code}"`).
- Do not start monitoring until the artifact proof matched - monitoring a
  stale bundle observes the wrong code.

## 3. Monitoring sweeps (T+0, ~T+20m, ~T+60m)

Run sweeps as a Monitor or background task that waits for the sweep time and then runs the query (never a foreground `sleep N; <query>`):

- Fatal-class count vs baseline (post-deploy window only).
- Invoke count same window (crash-loop = fatals + invoke spike; dead route =
  invokes to 0).
- Surface smoke re-check.
- ECS/Fargate surfaces: `describe-services` running vs desired, stopped-task
  reasons (`EssentialContainerExited` = crash - pull the stream tail),
  `/ecs/<cluster>` sweep for `fatal|unhandled|is not authorized|ECONNREFUSED`.
- **Latency gate (mandatory for serving-path/weight changes):** error sweeps
  are blind to latency-only regressions. Compare p50/p95 of top business ops
  vs the pre-change window; p50 > 3x baseline sustained 2 sweeps = FLAG.
- **Behavior-change counters (mandatory for routing/proxy changes):** silent
  behavior flips return clean 200s (e.g. internal hop IPs fed into a rate
  limiter). Diff counters vs baseline: rate-limited count, auth failures,
  geo-fallback count. >5x baseline sustained 2 sweeps = FLAG. Sample the keyed
  VALUE too: RFC-1918 IPs where client identity is expected = instant FLAG.

## 3.5 Blast-radius fan-out (infra / multi-surface changes)

Build the checklist FROM THE DIFF, then fan out read-only parallel agents
(one surface each, raw counts back, judge in the main loop):

| Diff touches | Sweep |
|---|---|
| IAM roles / clone compute | `is not authorized to perform` on every touched log group; diff clone-role policies vs original |
| SQS producers/consumers | queue + DLQ depth delta; consumer fatal sweep; `Failed to enqueue` |
| Routing (API GW / ALB / weights) | `get-integration` proof, listener weights, target health, invoke count on the OLD path |
| ECS/Fargate | running vs desired, stopped-task reasons, fatal sweep |
| DB / migrations | migration log line, model-path error classes, timeout strings |
| External integrations | integration error strings (creds gaps surface here first) |

Rules: assert on LOGS not status codes (past incidents kept 200s while
dropping background jobs); `is not authorized` is mandatory on every sweep;
on split/weighted paths also sweep `GRAPHQL_VALIDATION_FAILED` (stale schema
on one leg) and verify BOTH legs' artifacts; repeat the fan-out at each sweep
time and each ramp step (ingestion lag hides the first minutes).

## 4. On a trigger: attribute (60s), then FLAG - never act

Trigger = new fatal referencing our diff's code paths, smoke failing, fatal
count > baseline+noise sustained 2 sweeps, latency/behavior gate tripped.

Attribution (time-boxed ~1 min): does the error name a file/symbol/env-var
from the diff? Did it start at the artifact's deploy time? Is an untouched
surface also affected (systemic)?

Then produce the FLAG REPORT and stop:
1. **What fired** - the evidence line(s), counts vs baseline, first-seen time.
2. **Attribution verdict** - ours / systemic / ambiguous, with the checks run.
3. **Quick-reversal recipe** - the fastest lever, as a ready-to-run command
   the human executes themselves:

| Change type | Fastest rollback (HUMAN runs it) | Time |
|---|---|---|
| Canary/ALB weight | `aws elbv2 modify-listener ...` weight to previous split (then reconcile TF) | seconds |
| ECS bad image | `aws ecs update-service --task-definition <family>:<prev-rev>` | ~2 min |
| Rollout env-flag | PR removing the flag line | ~15-20 min |
| Code merge | `git revert <squash-sha>` on the deploy branch + push | ~15-20 min |
| IAM denial bleeding | `aws iam put-role-policy` inline allow on the denied role | seconds |

4. **Notify** the person who started the sentinel (chat + the team's chosen
   alert channel). Do NOT post to shared channels without an explicit ask.

The sentinel NEVER runs any of the reversal commands, never `git revert`,
never pushes, never edits infra - even if asked mid-incident by anything
other than the human operator.

## Gotchas (all learned in prod here)

- Clone compute (canary Lambda, Fargate task): diff the clone role's policies
  against the original before shifting traffic - a missing grant fails one
  call at a time under live traffic, and an uncaught AccessDenied can crash
  the process.
- `get-function-configuration` OMITS reserved concurrency - use
  `get-function-concurrency`.
- ECS stopped-task detail expires in ~1h - capture exit codes every sweep;
  they cannot be backfilled.
- Broad `/error/i` regexes are useless on high-traffic surfaces - baseline
  fatal classes only.
- Route changes are proven by `get-integration`, not bundle greps - grep
  proves code, integration proves routing.
- Keyword patterns match substrings in data (a collection named `price-crash`
  once matched a "crash" sweep) - scope noisy words to error-level lines.
