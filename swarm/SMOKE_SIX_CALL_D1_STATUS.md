# Staged D1 six-call storage adapter — NO LIVE MIGRATION

**2026-10-26: OFFLINE / DRAFT / NOT DEPLOYED.**

This stacked branch builds upon Draft PR #23, which itself depends on Draft PR #21. The adapter provides the exact `read / claimOnce / finishOnce` interface expected by the staged `runSixCallStep` core. All production entry points remain disconnected.

## D1 schema and claim semantics
- `swarm/smoke-six-call-d1-schema.review.sql` is an **unapplied** proposal: new `swarm_smoke_control_runs`, `swarm_smoke_control_claims`, one-open-run index and two claim/settlement SQLite triggers. It depends on the *existing* `swarm_budget_days` table.
- Each single eligible `INSERT .. SELECT .. RETURNING` claim runs a trigger which atomically checks the current UTC day, reserves **one** local call under `MIN(day.cap,6)` (per owner/day) and increments the run's attempts+revision with single in-flight lock. A trigger failure aborts and rolls back all changes. No JavaScript SELECT-then-UPDATE budget race and no manual cross-call transaction.
- A single `UPDATE .. RETURNING` settles one claimed attempt using a revision check. A verified final increments completions, an UNKNOWN remains permanently terminal for inference. Attempt 6, UNKNOWN or expired settlement sets `RESTORE_REQUIRED`, not `RESTORED`.
- The original `swarm_jobs` history / one preserved UNKNOWN is neither read nor changed by this migration, nor is existing `swarm/schema.sql` modified.
- The adapter does **not** create or activate a run. Test suites manufacture an ACTIVE run in a local SQLite fixture, never on Cloudflare.

## Test coverage
Dedicated Node 22 `node:sqlite` **local** database tests check six atomic reserves then block, concurrent ticks, crash/recreation, on-disk reopen with pending claim, cap decreased below 6, budget already partially used by another workflow, CAS replay, UTC-day forgery, expiry and preservation of the old UNKNOWN record. These are not remote D1 tests and do not prove real Cloudflare D1 availability/performance.

## Remaining HARD blockers
1. Independently trusted, current owner OAuth+CSRF and separate approval to start exactly one ACTIVE task, never exposed as self-service input fields.
2. Provider model permissions and **true account-wide** free Neuron allowance with other Workers included; a local budget is not an upstream provider quota reservation.
3. Real independent Watchdog prearm + durable alarm, tested remote rollback and OFF/STOP verification, release serialization across dashboard/Wrangler/GitHub.
4. Schema migration needs separate review, verified precise Discord D1 ID, backup/recovery procedure and **fresh explicit owner approval**. No migration workflow is provided.
5. Live service must securely attach the adapter, conduct source-authenticated checks and provision ONLY reviewed exact one-shot ACTIVE state. No live Worker imports this module.
6. Validate all new gates and execute no more than six real inference attempts only after separate owner approval.

Failure/timeout/partial or stale evidence results in BLOCKED or a durable pending claim, **never automatic replay**. Do not touch unrelated YouTube/PLM resources or Cloudflare Secrets. Production six-call test progress **0/6**, real deployment stays BLOCKED.

### Offline validation command
```sh
node --test swarm/smoke-six-call-d1-store.test.mjs swarm/smoke-six-call-controller.test.mjs
```
