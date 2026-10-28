# Six-call controller core — code only (2026-10-26)

**STATE: OFFLINE-STAGED / NOT READY FOR PRODUCTION.**

This stacked PR is intentionally based on draft PR #21 (`feature/discord-historical-unknown-readonly-20261025`) and MUST NOT be merged straight into main without reviewing that dependency. It adds an executable, *dependency-injected* one-step coordination core, but **does not deploy or wire it into the live Discord Worker**. The fake provider and in-memory CAS are present *only in tests*.

## Implemented
- `makeSixCallCandidate`: explicit pinned Discord resource, distinct baseline/smoke versions, one task receipt, 6-attempt maximum and <=20-minute absolute window; always creates `PENDING_EXTERNAL_ACTIVATION`, never ACTIVE.
- `runSixCallStep`: only reads an externally created ACTIVE record, independently rechecks all required evidence for each stage, requests globally atomic durable **claim and daily allowance reservation before invoking** an injected provider *once*, and settles with a CAS revision.
- A call reserved/claimed but with missing provider final, network timeout, expired post-claim clock, uncertain D1 claim or uncertain settlement is **never repeated**. Following unknown requires human recovery. Six confirmed finals lead to `SIX_CALL_LIMIT_REACHED` and baseline restore is required.
- No auto-retry, batch loop, mutable Secrets, direct Cloudflare/D1 APIs, new endpoints or production imports.
- Existing historical UNKNOWN must stay untouched; new accepted evidence must independently verify its exact original fingerprint and no new unknowns.

## Mandatory production adapters (NOT IMPLEMENTED or authorized)
1. A **private, real** owner OAuth+CSRF task receipt and *new separate owner authorization*, securely bound to immutable run/task IDs. Never derive any evidence fields from an incoming browser/API JSON object.
2. A trusted live evidence collector that validates signed identity, exact account/Worker/D1/version, independent armed Watchdog and tested baseline rollback, deployment serialization lock/fencing, four execution flags, today's genuine **account-wide** Free entitlements/model availability and sufficient Neuron margin including unrelated Workers AI. All signals need fresh, independent provenance. Merely setting the boolean fields to true or running mocked tests provides **no** authorization.
3. A durable D1-backed one-shot state store: `read`, `claimOnce` with a globally atomic revision compare-and-swap and same-transaction local daily reservation, and `finishOnce` with revision matching. Claims must survive crash/restart, and no active run may coexist or be replayed. Existing `swarm_jobs` is **not** this controller's transactional persistent store. Design/migration review required.
4. The scoped Workers AI provider adapter mapping indices 0..5 to their six role scripts, with verified final receipts; exactly one `provider.invoke` per claim. Provider-side usage is not reserved by any local call cap.
5. Independently armed and **live-tested** restoration/expiry alarm, a serialized release switch, correct post-restore active baseline and remote flags OFF check, signed POST rejection, D1 terminal verification and alert/manual recovery. This core only returns `restoreRequired`; it cannot perform rollback.

## Simulation/test caveat
The suite explicitly manufactures an ACTIVE record and sets `VERIFIED_FROM_TRUSTED_ADAPTER` fields in memory. They are **test fixtures**, not a real login, release approval, Cloudflare attestation or free-quota reservation. The source may be wired to live provider code **only in a separately audited, reviewed and explicitly authorized release**.

## Stop conditions
UNKNOWN preserved historical result, provider timeout/error, untrusted owner token, missing/aged evidence, wrong Worker/D1, more than six attempts, 20-minute expiry, concurrent or uncertain CAS, failed STOP/Watchdog/rollback proof, free quota ambiguity, model unavailability, failed restore or active other jobs -> **BLOCKED**, no retry, no live deploy. Never touch YouTube or Project Love Machine.

### How to test offline
```sh
node --check swarm/smoke-six-call-controller.mjs
node --test swarm/smoke-six-call-controller.test.mjs
```

**Production test counter remains 0 / 6.** Existing live Worker remains unchanged and safe OFF.


### 2026-10-28 post-claim state-drift guard (offline review)

After a durable once-only claim, the controller's second D1 state read must
also match the initially pinned `createdAtMs` and continue reporting
`historicalUnknownPreserved===true`. Previously these two fields were checked
before the claim but not after it, so a simulated mid-await mutation could
reach the mock provider. An adversarial unit test now requires one consumed
claim, zero mock inference calls and terminal UNKNOWN_STOP on either drift.
This is a staged controller-only change: it does not independently prove the
original historical UNKNOWN row, activate the Worker, or authorize live calls.
