# Discord GPT Relay — 6-role smoke test, no paid browser credits

**Status: OFFLINE PREPARATION ONLY.** This file does not authorize a deployment or start an AI job.

## Approved intent
- Exactly one owner-created task, **1 cycle / max 6 inference attempts**.
- Dedicated Discord Worker and Discord-only D1; no changes to YouTube or Project Love Machine.
- Current Free usage must be checked freshly; the local call reservation cap is **not** account-wide Neurons metering.
- No automatic retry or repeated follow-on task.
- Finish with all four SWARM execution flags **OFF**, and verify remote state.

## Required code safety gates
1. Existing original Worker must be healthy, signed POST unauthenticated response = 401.
2. Owner-only login and CSRF are mandatory for create and STOP. The UI's emergency STOP must POST successfully even when the model runner is OFF, as long as the read/API flag remains on.
3. New *smoke window* guard: with `SWARM_DAILY_CALL_CAP=6`, the Worker will not schedule inference unless `SWARM_SMOKE_EXPIRES_AT` is a 13-digit absolute UTC epoch **in milliseconds**, strictly in the future and at most **20 minutes away**. `expires_at` is an absolute value (not a recurring cron string). A missing, invalid or expired value must disable all further six-role inference.
4. A smoke-window expiry does **not** cancel an inference that has already been sent to Cloudflare; allow claimed work to settle or become terminal UNKNOWN without retry.
5. Stop and verify the job is terminal before turning `SWARM_API_ENABLED` OFF. After the API flag is OFF, the STOP route itself returns disabled, so do not hide it while an active job may still exist.
6. **Provider-side Free quota cannot be guaranteed by a local cap**. Do not test unless the latest account usage is within its genuine free allocation, accounting for unrelated Workers/AI.

## Deployment / rollback prerequisites — not executed in this PR
- Verify the exact active Worker version and preserve its version ID for a rollback.
- Verify active GitHub Actions=0, legacy D1 jobs=0, swarm D1 jobs=0, schema and cap table valid, model available, signed Discord handler, owner OAuth, and remote SWARM flags OFF.
- Prepare a separately approved, account/Worker-scoped **temporary version** with `SWARM_API_ENABLED=true`, `SWARM_RUNNER_ENABLED=true`, `SWARM_EXECUTION_APPROVED=true`, `SWARM_EXCLUSIVE_MODE=true`, `SWARM_DAILY_CALL_CAP=6`, and the short expiry.
- Before activation, validate a **separate reliable OFF/rollback action**, including a fallback if the first Actions job is cancelled. A try/finally block alone is not enough, as CI can lose power or be cancelled.
- Confirm old version rollback preserves private OAuth, D1 binding, Discord signed commands and YouTube/PLM isolation.
- Authorize one owner task through the **existing Discord OAuth browser** (not via raw database writes or bypassing CSRF).
- Observe up to six scheduled steps; do not restart or requeue `unknown`, `failed`, or `quota_wait` without new explicit authorization. Each claim counts against the local budget.
- When job is terminal (or permission expires), restore the exact baseline Worker version and verify all four remote SWARM vars are absent/false. Verify no active D1 job. If this verification fails, report BLOCKED and do not claim the test was safely closed.
- If the monitoring/rollback mechanism or Cloudflare account status cannot be confirmed, **do not enable the test**. Use the owner's ordinary Cloudflare dashboard and the original Worker version rather than paid browser automation.

## Free browser path
The owner can use their ordinary browser already signed in to Cloudflare and Discord. A browser-control plugin or paid TinyFish credit is **not required** for the owner to open the private portal. Do not request passwords, tokens or MFA codes in ChatGPT.

## Status distinctions
- PR code tests PASS = no real inference happened.
- D1 tables present + model script uploaded = not proof the six-role loop is running.
- Task completes 6/6 = single smoke test done, not proof of 24h unattended stability.
- 24h unattended stability must be observed separately after a new safety approval.

### Production actions still blocked
This Draft PR only contains isolated code/test/docs. **No merge, Worker deployment, flags, secrets, D1 writes or live AI jobs** occur from it.

## 2026-10-13 — independent auto-OFF eligibility guard (STAGED; NO LIVE ACTION)

A standalone **pure offline** module, `swarm/smoke-restore-guard.mjs`, now validates
whether a future independent watchdog would be allowed to restore a known
**OFF** Worker version. It requires exact Discord-only Cloudflare account,
Worker and D1 identities, distinct known baseline and temporary-smoke version
IDs, a single 100% live version, validated remote plain-text flags, local cap=6,
and an exact absolute smoke expiry. If the live version differs from both known
versions or deployments are split, it reports BLOCKED rather than blindly
overwrite concurrent changes. It can also authorize an early owner emergency
restore, but only for the exact known smoke version.

**Important:** This module **does not perform restoration or schedule a
watchdog**. This PR must not be presented as proof that remote SWARM flags will
turn OFF on their own. Before a live test, a separate owner-approved OFF action,
independent monitoring/recovery mechanism and a real end-to-end dry-run must
succeed. A GitHub scheduled action alone is insufficient because GitHub can
delay or drop scheduled workflows. The code-level expiry halts new AI stages,
not in-flight calls nor the remote configuration binding state.


## 2026-10-13 — staged Discord-only restore executor (NOT LIVE)

The stacked draft branch has executable, dependency-injected code in
swarm/smoke-restore-executor.mjs using Cloudflare Workers deployments and version
details REST endpoints. Unit tests simulate the real HTTP GET/POST sequence;
CI must never supply a real Cloudflare token to these tests.

Before a real restore it requires, in addition to explicit one-shot owner
approval, exact Discord account/Worker IDs, known distinct baseline/smoke version
IDs, a pinned deployment ID, single 100% active version, matching D1 LOOP_DB
binding and names of four Discord secrets in both versions. Baseline must have
all SWARM flags absent/false; smoke version must have four true flags and
SWARM_DAILY_CALL_CAP=6 and matching 13-digit absolute expiry. The existing
eligibility guard determines whether restore is permitted, and a second deployment
GET rejects detected concurrent deploys. After a one-shot restore POST, the
executor checks the live version and unsigned Discord POST=401 and root health.

**It does not yet provide unattended auto-OFF.** This file is not imported by a
production Worker or deployed by CI. There is no independent recovery scheduler,
no production controller feeding signed/pinned inputs, no real token-scope
attestation, no real D1 terminal job verification, and no post-rollback remote
bindings reread. Cloudflare API deployment is not an atomic compare-and-swap:
a different operator deploying during the small GET-to-POST window could still be
overwritten. Such races require release serialization / an external coordinator.

No live smoke can start until all these external protections are implemented,
approved and tested. An interrupted/uncertain POST is **not** automatically
retried. A successful simulated restore is not proof of safe production shutdown.
Never replace unknown versions or change unrelated YouTube/PLM resources.


## 2026-10-13 — independent watchdog OFFLINE implementation (NOT DEPLOYED)

The stacked branch after PR #10 introduces a *separate* Cloudflare Worker
(source: swarm/smoke-watchdog-worker.mjs; sample config:
swarm/wrangler.watchdog.example.toml). It is not imported by the existing
Discord Worker and contains no credentials, enabled flags or runnable deployment
workflow. GitHub Actions only executes mock/offline tests.

Design:
1. The existing primary Discord Worker six-role inference must independently
   fail closed at the 20-minute absolute smoke expiry (already staged in PR #8).
2. A separately approved WATCHDOG Worker Cron tick checks a precise one-smoke
   authorization and exact account / Worker / Discord-only D1 / versions /
   expected deployment ID. Any missing field, misconfiguration or early tick is
   BLOCKED/WAIT without a network request.
3. After expiry, a dedicated Durable Object SQLite-backed singleton
   atomically stores an irrevocable one-shot attempt marker BEFORE any
   restoration request. If the call times out or the script crashes, future
   scheduled ticks will NOT automatically repeat it.
4. The independent Worker reads legacy and swarm D1 status using a dedicated
   D1 Read credential (only SELECT SQL); it never writes the Discord D1.
5. The code-only PR #10 executor validates the OFF baseline and the exact
   temporary smoke version, detects obvious concurrent Worker changes, and
   attempts a single version restore. The watchdog independently rereads
   the live version, four remote OFF bindings, dedicated D1 binding and job
   counts after the restore.
6. Existing queued, claimed, quota_wait, pending stop, unknown, or read failures
   are reported as BLOCKED / INCONCLUSIVE even if the version was restored.
   Restore does NOT cancel an in-flight model invocation and does not
   change queued D1 jobs. Do not requeue UNKNOWN or assume a job completed.

Important real-world limitations:
- **NOT guaranteed real-time.** Cloudflare Cron itself can be delayed or
  unavailable. No online/real-worker proof exists; code expiry is only an
  additional barrier against starting new inference.
- The deployment GET-before-POST check is not an atomic server-side
  compare-and-swap. A concurrent operator deploying within that interval
  could be overwritten. Full release serialization and an independent
  external recovery/alerting plan remain separate required verification gates.
- Durable Object marker is one-shot, so after ANY ambiguous result a human
  must check remote state. The marker MUST NOT be silently cleared and
  no automatic retry/rearm may happen.
- Owner's explicit separate approval is required for provisioning the
  independent Worker, Durable Object, Cron, secrets, D1 Read token, any
  real rollback, or enabling AI; nothing here authorizes these actions.
- The config is deliberately UNARMED with pinned versions/expiry UNSET.
  Never place credentials in GitHub, source code, chat or wrangler config.
- D1 read permissions and Worker edit permissions must be separately scoped
  by the owner. Free entitlement, Workers AI Neuron usage, production jobs,
  OAuth owner login, real disable round trip, token scope and preview/production
  behavior require new live verification prior to initial inference.
- No impact to existing Discord commands, YouTube, PLM or other Workers is
  acceptable.

Verification gates:
- Unit tests: before/after deadline, once-only Durable Object claim, API
  timeout without retry, concurrent/split version rejection, missing
  credentials, wrong resource, D1 UNKNOWN/active, unreadable D1, remote
  binding validation and original Discord security health.
- Offline CI 3 checks PASS is only source/test readiness, NOT live proof.
- The initial smoke remains BLOCKED until independent production monitoring,
  a verified rollback path, post-restore OFF-state checks, and free quota check
  are approved and observed in the dedicated Discord account.


## 2026-10-13 — independent Free/production evidence preflight (OFFLINE ONLY)

The staged module `swarm/smoke-live-preflight.mjs` is a pure, no-network
readiness evaluator. It takes an externally obtained, 5-minute-fresh snapshot
and rejects any missing or inconsistent evidence for the Discord-only target:
current Worker deployment and distinct version IDs; exact four SWARM flags
absent/false; correct Discord D1; zero legacy/6-role/UNKNOWN/STOP-pending
jobs; zero running GitHub Actions; owner OAuth and unsigned signature
rejection; live-tested rollback, independent Cron and permanent one-shot
latch; release serialization and manual recovery/alerting.

It also requires owner-verified Free plan and an available Cron slot,
current UTC-day account-wide Workers AI usage from the dashboard,
a conservative allowance reservation for the six attempts, no unrelated
AI jobs, model access, and a 20-minute-or-shorter absolute deadline.
A local reservation counter alone never proves Cloudflare's account-wide
Neuron allowance.

**It NEVER authorizes live inference or production changes.** Even when all
supplied evidence fields pass, the output is OWNER_REVIEW_REQUIRED with
REALTIME_QUOTA_NOT_RESERVED and NON_ATOMIC_DEPLOYMENT blockers. Cloudflare's
Billable Usage API (released August 2026) refreshes daily, not per
request, so it is not proof of a current free balance. Dashboard readings
can also change after observation if another project uses the account.

This preflight is an offline decision aid, not a token/scope verifier, login
checker, provider-neuron quota allocator or an automatic release system.
Live usage and version state must be checked again after separate owner
approval and before any one-cycle test. If accurate account-wide usage or
the independent fail-safe mechanism cannot be verified, remain BLOCKED.


### 2026-10-13 Read-only live evidence adapter (offline-tested only)

The module swarm/smoke-readonly-collector.mjs can collect exactly scoped
Cloudflare Worker deployment/version/binding snapshots, unsigned POST rejection,
two SELECT-only dedicated Discord D1 aggregate queries, and the public GitHub
Actions statuses. It does NOT deploy, start inference, modify flags, write
D1, or connect to YouTube/PLM. Secrets/token values are never included in
its evidence report. This is a library function only: CI uses fake HTTP
responses, no production credentials.

The caller must supply separately approved, least-privilege Cloudflare
Workers Scripts READ and dedicated Discord D1 READ tokens at runtime; never
paste them into chat, commit them to the repository, or store them in this
public Draft. No account-wide free-Neuron usage, owner OAuth, expiry, or
rollback certification can be inferred from those GET/SELECT queries. The
offline evaluator therefore remains BLOCKED until independent evidence
is furnished, and even a complete evidence set is only OWNER_REVIEW_REQUIRED,
not authorization to deploy. A failed read is not silently interpreted as zero.

This reduces manual uncertainty in the eventual *read-only* production
preflight without enabling any live action or altering the Free account.


### Independent deadline alarm backup — code only

A second scheduler now uses Durable Object Alarm in the separate staged Worker.
During a strictly owner-approved expiry window of <=20 minutes, its Cron tick
arms one deadline alarm in the dedicated DO. The existing independent Cron
still checks expiry normally; when DO alarm fires, BOTH paths share the same
permanent transactional 'attempted' marker BEFORE any Cloudflare restore POST.
This prevents a duplicate restore request even though Cloudflare DO alarms
have at-least-once delivery and can invoke an alarm again after a crash.
No automatic retry after ambiguous API receipt.

A DO alarm may be delayed or unavailable, and does NOT cancel an in-flight
Workers AI request. Do not advertise a hard real-time guarantee; an owner
fallback/notification and real live round trip remain blocked. Code tests
use mock storage and never arm a real Cloudflare DO. The public Worker
fetch endpoint remains HTTP 404 and it cannot be armed without the exact
Discord-only approved target and absolute 20-minute-or-shorter deadline.


### 2026-10-13 — Cloudflare REST contract and stale authorization checks

The official Cloudflare API documentation states that the first entry of
`GET /workers/scripts/{script}/deployments` is the latest deployment
*actively serving traffic*. The staged executor now trusts the explicitly
documented first entry, **not a re-sort of created_on timestamps**.
Offline regression tests simulate conflicting timestamps and verify that
the 100% active version and exact expected deployment ID are honored.

The watchdog and directly callable executor now reject any restoration
authorization more than 20 minutes after the explicit smoke expiry,
without consuming the DO one-shot marker or contacting Cloudflare.
The executor also rejects an emergency restore more than 20 minutes
before the deadline. These are **stale-request safeguards**, not a
guarantee of automatic remote OFF at the 20-minute expiry. A delayed
Cron/alarm beyond the stale interval requires a separate manual
investigation and separately approved remediation rather than blindly
overwriting a newer Worker deployment. An independently reliable alert
and manual recovery procedure remain a blocker to live deployment.

No Cloudflare production requests, version restores, tokens, D1 mutations,
SWARM flag changes or inference are part of this PR update.
