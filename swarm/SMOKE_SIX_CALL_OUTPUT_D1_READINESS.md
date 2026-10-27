# Six-call D1 verified final output persistence — additive REVIEW ONLY (2026-10-27)

The reviewed 6-call controller consumes one durable claim per model attempt. PR #36 added a staged Workers AI adapter that requires durable, digest-verified final output storage before reporting `FINAL_VERIFIED`. This patch supplies the **missing source-controlled additive D1 table and storage capability**, but does not apply it to remote Cloudflare D1.

## Data and proof path
- Review-only `swarm/smoke-six-call-output-artifacts.review.sql` adds a `swarm_smoke_control_outputs` table linked to `swarm_smoke_control_claims` by (run_id,stage_index), restricted 0–5 and one row per stage.
- `swarm/smoke-six-call-output-d1.mjs` verifies exact server-side run ID, original task receipt ID, Discord owner, 0–5 role, expected claim revision, SHA-256 of final text and receipt ID. Bound 2,200 characters / 2,400 bytes; no raw secrets, logs or provider request.
- Single `INSERT … SELECT` checks the claim is still `CLAIMED`, matching D1 revision/in-flight stage and owner, run ACTIVE and STOP=0, within its <=20-minute lease. It then SELECTs the saved row and verifies its exact digest/receipt. **No retry** after ambiguous insert/readback.
- The next stage reads only the prior stage's persisted output if its claim is already `FINAL_VERIFIED`. On STOP or unknown provider/D1 outcome, subsequent steps are denied.
- A full **real local SQLite** test exercises 6 fake Workers AI calls, 6 atomic reservations, 6 D1 output rows, terminal restore requirement and no 7th stage; race/failure tests cover STOP, unknown claim, duplicate output, digest forgery and missing previous stage.
- No live inference/Cloudflare API tokens/Workers deployment/D1 migration/secrets changes in this PR.

## Still required for an actual live release
- The migration SQL has **NOT been applied** to production, requires a D1 backup, rollback acceptance and separate owner approval. Live SQL definitions/hashes and original historical UNKNOWN must be checked after any approved migration.
- Production `worker-relay.mjs` still does not import the six-call controller. The owner-authenticated D1 task source, real server-generated preflight attestations and model/Free Neuron balance are not integrated.
- Real independent Watchdog auto-OFF and restore test, account-global release lock and owner OAuth+CSRF live consent must pass separately. Free Workers request and Cron budget plus installed AI binding do not attest the Workers AI Neuron remainder.
- Any ambiguous inference or output persistence is terminal UNKNOWN, no automatic retry, and does not permit cleanup of the preexisting historical UNKNOWN.

**Free plan stays unchanged. This is OFFLINE-only. Actual provider inferences remain 0/6; live release BLOCKED.**
