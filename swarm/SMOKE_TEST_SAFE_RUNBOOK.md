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
