# Six-role Discord D1 Migration Readiness — READ-ONLY AUDITED, NOT APPLIED

**Status: BLOCKED / owner approval required for all live database writes.**
This document is not authorization to run SQL, publish a Worker, enable the runner, or invoke AI.

## 2026-10-12 real production observations

The dedicated Discord-only Cloudflare D1 is `discord-relay-loop-state` (UUID
`d80b08a4-0ff7-4320-9575-0d3c55cf7aba`, account `6c8ccd6aface937ab5dabef61cb64534`).

[Read-only schema/active-job check](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38253481845)
reported:

- `relay_loop_jobs`: **0 active** at check time (not a lock for future writes).
- `swarm_jobs`: **absent**.
- `swarm_budget_days`: **absent**.
- `swarm_single_active_job`: **absent**.
- `swarm_owner_created`: **absent**.

The current live Worker is still the two-role GPT-OSS Command Center. PR #1 and
PR #6 were **code-only** merges; no new database table, Worker deployment, AI
call, Secret or execution-flag mutation was approved.

## Exact migration proposal — future explicit approval only

File: `swarm/schema.sql`.

The migration contains only:
- `CREATE TABLE IF NOT EXISTS swarm_jobs`: one active job, 1–3 six-role cycles,
  max 18 attempted calls, checkpoint/lease/STOP/status fields.
- `CREATE TABLE IF NOT EXISTS swarm_budget_days`: local, per-owner UTC-day
  reservation count (NOT Cloudflare account-wide Neurons/billing).
- `CREATE UNIQUE INDEX IF NOT EXISTS swarm_single_active_job`.
- `CREATE INDEX IF NOT EXISTS swarm_owner_created`.

The existing `relay_loop_jobs` table is not altered. These are still D1 writes
and **have not been executed against the real Cloudflare database**.

## Required preflight and safe order

1. Obtain a **separate explicit owner authorization for only the exact SQL**
   after verifying the isolated database name + UUID, a backup/recovery path,
   the absence of other D1 writes/migrations, and the latest Worker/Actions
   state. The shared Cloudflare account might also host unrelated D1 databases;
   don't grant account-wide D1 Write to an existing production Worker token.
2. Read-only query immediately before the change:
   `SELECT COUNT(*) AS active_jobs FROM relay_loop_jobs WHERE status IN ('queued','claimed') OR active_slot=1;`
   Require the exact SQL query to succeed with integer result **0**; stop on
   unknown state, permission errors, or concurrent updates.
3. Before applying, recheck the four exact objects using:
   `SELECT name,type FROM sqlite_master WHERE name IN ('swarm_jobs','swarm_budget_days','swarm_single_active_job','swarm_owner_created') ORDER BY name;`
   If any unexpected object exists, **BLOCK** rather than assume that
   `IF NOT EXISTS` means schema compatibility.
4. Apply `swarm/schema.sql` **only** to this Discord D1 after approval,
   without a production Worker cutover.
5. Verify the two tables + two indexes and that existing `relay_loop_jobs`
   is still accessible; collect read-only schema metadata and confirm both
   swarm tables have 0 rows before enabling any new job creation.
6. Keep `SWARM_RUNNER_ENABLED`, `SWARM_EXECUTION_APPROVED` and
   `SWARM_EXCLUSIVE_MODE` off. Don't set `SWARM_API_ENABLED` on live until a
   separate Worker release is explicitly approved. No publishing or calls in
   this migration step.

## Go-live is a separate decision

Never infer that a successful schema migration makes six-agent runtime
functional. Remaining approvals/verification: actual Workers AI provider
budget/remaining Free allowance, low `SWARM_DAILY_CALL_CAP` (1–18),
owner-only OAuth/CSRF, legacy-queue exclusion, production deployment with
known rollback, one explicitly approved inference smoke task and extended
STOP/unknown-outcome observation. A local call cap does **not** guarantee $0
account-wide Cloudflare usage. The previously observed two-role
`MODEL_ERROR` is still provider-detail-unresolved.

## Emergency STOP independence

Owner-only `stop` should continue functioning (CSRF and session required)
even if the model runner flags were later disabled. Read-only owner dashboard
must expose STOP for active `queued`, `claimed` and `quota_wait` jobs.
It must not allow `create` or `resume` while execution is disabled.

Any failure is `BLOCKED`. Do not auto-retry an unknown model outcome, do not
enable 24/7 autonomous inference merely because a Cron exists, and never touch
YouTube / Project Love Machine or non-Discord Cloudflare databases.
