# Discord six-call durable STOP / Watchdog reconciliation — offline staging

Date: 2026-10-26. Depends on stacked Draft PRs #21 -> #23 -> #24 -> #25. This change remains **OFFLINE ONLY** and must not be imported or deployed without new scoped owner authorization and independent review. It never modifies the live Discord Worker, Cloudflare or D1 state.

## Engineering completed for review

1. Proposed (UNAPPLIED) D1 schema now includes `stop_requested` and prevents STOPped runs from atomically reserving new calls. An active in-flight claim is **not** blindly cancelled and its CAS revision is retained, so its one confirmed final or UNKNOWN can settle exactly once into `RESTORE_REQUIRED`. No claim replay.
2. D1 adapter `requestStopOnce({runId,ownerId,nowMs})`: one owner-scoped SQL UPDATE that records the STOP durably. Idle ACTIVE -> `RESTORE_REQUIRED`; pending review -> `BLOCKED`; in-flight ACTIVE retains the stage for single resolution but cannot reserve another. No external STOP route is wired and no unknown owner status is disclosed. No remote Worker action.
3. Six-call controller aborts before live evidence/provider handling if `stopRequested===true`.
4. `reconcileSixCallSmoke` is an OFFLINE-only pure state auditor joining D1 run state, its six-step receipts, independent Watchdog prearm receipts, and post-restore baseline proof. It **never sends** a Cloudflare restore, STOP, model invocation, or DB mutation.
5. New isolated `handleSmokeOwnerStop` API (not connected to production) reuses the existing Discord OAuth cookie, verifies real owner session, same-origin and CSRF, accepts only an exact STOP-only request and works irrespective of the AI runner flag. It calls D1 `requestStopOnce`, not a Cloudflare deployment REST API, and returns `remoteBaselineRestored:false` until a separately verified independent rollback happens. Attempts to stop another owner's task never disclose owner details.
6. Fail-closed rules: exact Worker+account+D1+version identities; <=6 attempts, <=20-min window; expected claim indices; UNKNOWN remains incomplete; in-flight ambiguity triggers manual recovery; independent alarm/latch and release fence must be confirmed BEFORE traffic switch; postrestore baseline must be sole 100% deployment with all four flags OFF, correct D1 binding, zero active jobs and exactly one preserved historic UNKNOWN; signed Discord POST 401, owner STOP available, Watchdog parked; <=5min snapshot freshness. These proof objects are **mock-only** and do NOT authorize a production action.

## Live restrictions remain
- The actual detached Watchdog Worker has offline tests but has **NOT** been certified as independently armed, reliable or correctly integrated with this new controller in production. There is no automatic production recovery guarantee from these tests.
- A real, scoped Cloudflare D1 migration is not authorized or performed. The new `stop_requested` column is in a **review SQL file** only. Existing D1 records, including the preserved original UNKNOWN, are untouched.
- The owner OAuth+CSRF route is currently only a review-request preparation endpoint in an unmerged Draft. No separately authorized activation endpoint, true upstream Free Neuron allowance proof, model access proof, release serialization across all operators, or provider adapter exists in production.
- On uncertain provider outcome, do not retry or silently clear UNKNOWN; manual recovery is required. A `RESTORE_REQUIRED` state is a request for independent recovery, **not evidence it happened**.
- Do not merge directly to main, deploy, toggle SWARM flags, arm Watchdog, write live D1, invoke AI or change Secrets, YouTube or PLM from this PR.

## Decision for any actual smoke
**BLOCKED** until trusted live proof, reviewed candidate, backups, real restore dry-run, current billing/Free entitlement, fresh owner-specific approval and serialized deployment. Newly verified actual model calls: **0/6**.

## Audit note: authenticated STOP is not a proven remote recovery
The tested OAuth-stop handler is not imported by `worker-loop.mjs`, the deployed Command Center, or any release workflow. Until the separately approved production owner route is live and the independent Watchdog has passed a real deployment/rollback dry run, the stop handler cannot be advertised as an available production emergency control. If D1 is unreachable, the handler fails closed and requires a separate manual Cloudflare safe-OFF response.
