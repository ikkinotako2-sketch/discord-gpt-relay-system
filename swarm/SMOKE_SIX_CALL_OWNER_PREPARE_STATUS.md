# Discord six-call owner review preparation — OFFLINE ONLY (2026-10-26)

**Not connected to production. Not an AI launch or release approval.**

This branch is stacked on PR #24 (which depends on #23, then #21). It adds a proposed narrowly scoped owner-only preparation handler `handleSmokeOwnerPrepare` without importing it into the existing Worker, Command Center router, or Cron.

### Protected workflow
1. The *existing* Discord OAuth owner login proves user identity and issues a signed, expiring `dc_session` HMAC cookie with a per-session CSRF token. This module reuses `authenticateDashboard`; it does not accept a client-provided `ownerId` or OAuth proof flag.
2. The request requires exact POST `/command-center/api/swarm/smoke/prepare`, same-origin `Origin`, `Content-Type: application/json`, matching `X-CSRF-Token`, acceptable Fetch Metadata, a <=256-byte JSON body with **only** `{"intent":"REVIEW_ONLY_NO_LIVE_ACTIONS"}`.
3. Preparation requires its OWN separate `SMOKE_OWNER_PREPARE_ENABLED='true'` configuration (not present or enabled in current production), the existing dashboard configuration and all four SWARM execution flags **OFF**.
4. Pinned target/version/deadline come from a separately trusted, server-side `loadReviewedPlan` capability. They are **never** taken from the browser request; the handler refuses missing/stale/unverifiable plans and plans with a window exceeding 20 minutes.
5. Server generates run ID and receipt ID; derives owner identity exclusively from the verified session. One SQLite `INSERT ... RETURNING` stores an isolated **PENDING** review record with 0 attempts/0 completions. A separate *unapplied* unique-index migration guarantees at most one `PENDING|ACTIVE|RESTORE_REQUIRED` run even under concurrent requests.
6. API returns 202 `PENDING_REVIEW_ONLY` with `authorizesInference:false` and `authorizesDeployment:false`. Repeated submissions return 409; tampered origin, CSRF, cookie, body, or plan is rejected. It cannot activate or run a task.
7. Old `swarm_jobs`, including the one preserved historical UNKNOWN, remains unchanged; there is no model call, Watchdog arm, Cloudflare REST call, Secrets update, release switch or deployment.

### Unimplemented and mandatory before ANY live rollout
- Independent review of the existing Draft PRs #21, #23, #24 and this PR. Stacked branches must be merged in reviewed order, after separately approved scope.
- Fresh explicit owner approval for **actual** one-time production Worker/D1 modifications, not just an OAuth session or a review request. The owner-review preparation record is **not** permission to invoke AI.
- Migration safety review, dedicated D1 backup/rollback and explicit authorization. Both schema proposals are currently **NOT APPLIED** remotely.
- A trusted `loadReviewedPlan` implementation backed by verifiable exact Worker/versions, current D1 safe-OFF, independent release lock/fencing and staged Watchdog that can safely restore baseline. Boolean caller inputs are not cryptographic proof.
- A separate **atomic activation** process that validates current owner OAuth+CSRF, a genuinely new one-shot approval receipt, current provider free Neuron margin and model access and all live safety gates. No activation API exists here.
- Confirm no unintended effects on legacy Discord routes, YouTube, PLM or unrelated Workers AI. Existing known UNKNOWN must stay immutable, never retried.
- A real independent Watchdog/STOP and observed restore test after fresh authorization; a mocked test is not enough.

### Offline tests
```sh
node --test swarm/smoke-six-call-owner-prepare.test.mjs swarm/smoke-six-call-controller.test.mjs swarm/smoke-six-call-d1-store.test.mjs
```

All test credentials, JWT-like cookies, SQLite databases and pinned plans are local test fixtures. They do not prove live Discord OAuth availability, current Cloudflare D1 deployment readiness or capacity. Current real 6-call smoke: **0/6**, production: **BLOCKED**.
