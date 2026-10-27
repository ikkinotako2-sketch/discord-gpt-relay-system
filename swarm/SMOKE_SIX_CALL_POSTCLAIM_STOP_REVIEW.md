# Six-call postclaim owner STOP & migration backup acceptance — offline-only

Date 2026-10-27. This Draft review branch is stacked after Draft #33 (#32 → #31 → #30 → #29 → #28 → #27 → #26 → #25 → #24 → #23 → #21). It changes NO Worker production entrypoint, no Cloudflare or D1 state, no Secrets/flags, no provider inference and no main commit.

## Safety issue fixed (not a complete real-world STOP guarantee)
Before this change, the coordinator read STOP before making a durable D1 claim, but could invoke a model **after an owner STOP landed between claim and inference**. With the patch, a freshly claimed inference:
1. verifies an actual durable one-shot claim and local daily-budget reservation,
2. **reads the D1 run again immediately before AI invocation**, requiring the correct pinned run/receipt/version/revision/in-flight index, `ACTIVE`, `stopRequested===false`, and unchanged expiry,
3. requires a still-valid clock below absolute expiry before one provider invocation,
4. treats a failed D1 read, STOP, unexpected state, or deadline lapse **after claim** as `UNKNOWN` terminal settlement; already claimed allowance is never returned/retried,
5. treats STOP/expiry arriving *during an already in-flight provider call* as `STOP_OR_EXPIRY_RESTORE_REQUIRED` even when a final result was verified. Never silently signals another inference stage after STOP.

**Important race limitation:** a STOP arriving after the last D1 read may still overlap an AI provider call; this coordinator is not a transaction covering an external provider. An independently prearmed, live-proven Watchdog and manual recovery are still required. Owner STOP means no **new durable claim**; it cannot guarantee an already claimed provider call never starts or finishes.

## Offline migration/backup tests
- Real Node 22 SQLite is used to apply the proposed review-only schema (two tables, two indexes, two triggers), check the independently pinned SHA-256 manifest, confirm idempotent migrations and verify `PRAGMA integrity_check`.
- One local disk `VACUUM INTO` backup is created **before** applying new schema. The backup reopens with the historical original UNKNOWN unchanged and without the staged six-call tables, demonstrating offline restore of the source state.
- A duplicate active/PENDING smoke attempt fails the UNIQUE index. A cap-exhaustion trigger aborts one claim and does not modify the local budget, controller counters or preserved original UNKNOWN.
- Fault-injection tests cover postclaim STOP, D1 read outage after claim, stale/wrong version and clock, STOP while provider is in flight, two scheduler triggers, six then deny seventh, provider UNKNOWN, previous historical job unchanged.

## GitHub Draft-chain completeness / TOCTOU safety hardening
- Identified a stale GitHub readiness collector that verified Draft PRs only through **#28**, despite actual dependencies continuing through **#34**. Updated its mandatory pinned chain to cover PRs #21, #23-#34 in exact base/head order.
- Optional, **non-authorizing** `extraDrafts` accepts reviewed *next* Draft numbers and branches and independently GET-verifies every exact link, avoiding implicit success when the chain grows. The fully verified last SHA must equal a caller-pinned SHA. Origin/fork mismatches, missing Draft PRs and changed bases are rejected.
- Rechecks all five GitHub Actions active statuses **after** reading the complete PR chain. If Actions start during collection, a stale zero-run result must never be returned. This GET sweep does not fence Github or Cloudflare, and a resumed run after the check still requires a fresh live preflight.
- Every output remains strictly `authorizesLiveActions:false`, `authorizesInference:false`; a mocked reviewed chain is not owner consent or provider quota.

## Not completed here
Cloudflare remote D1 migrations/backup/restore, independent Watchdog actual rollback, consented owner OAuth+CSRF activation, account-global Dashboard/Wrangler/GitHub release exclusion, genuine current account-wide free Neuron margin/model availability and real six calls remain **UNVERIFIED / BLOCKED**. A local backup is not a production backup.

**No live merge/deploy, no actual AI calls. 0 / 6 real attempts.**
