# Discord six-call D1 schema and ledger read-only audit (2026-10-27)

**Not connected to production. No real Cloudflare REST call performed.**

This change is stacked after Draft PR #29 (plus #28 → #27 → #26 → #25 → #24 → #23 → #21). It includes a standalone **read-only** D1 metadata/counter collector. Cloudflare D1 REST endpoint uses **HTTP POST as a transport for fixed `SELECT` SQL**; the SQL is never received from a caller and cannot write.

## Strict evidence limits
- Audit six expected SQLite schema objects of two control tables, two UNIQUE indexes, two triggers. None existing -> `MIGRATION_UNAPPLIED_CONFIRMED`; subset present/wrong type -> `BLOCKED`; all present -> read aggregate counters and **`MIGRATION_OBJECTS_PRESENT_REVIEW_REQUIRED` at best**. Matching object names and types does **not** prove their SQL definitions.
- Ledger aggregates include run count, reserved attempts, final receipts, pending/open runs, STOPped and in-flight count, new UNKNOWNs and total claims; inconsistent counters or concurrent unsettled tasks are never classified as clean.
- No owner IDs, run IDs, receipts, table SQL source, secret token, or raw records returned. Existing historical `swarm_jobs` UNKNOWN is untouched and **not independently verified** by this component; use separate authenticated historical audit.
- All return values: `authorizesD1Writes:false`, `authorizesLiveActions:false`, `authorizesInference:false`, `authorizesDeployment:false`. Even an exact empty migrated schema is not approval to migrate or launch.
- No network call is made by GitHub CI; tests emulate the D1 REST response with local Node SQLite and verify **all SQL begins with SELECT and contains no modifying verbs**.
- D1 REST reads are not a single transaction with Cloudflare deployments, Watchdog or GitHub status. Output must not be treated as authoritative if the operational freeze is missing or evidence is stale.

## Remaining gates
The proposed schema remains **UNAPPLIED** until independently reviewed backup/rollback and new owner approval. The actual account-wide Workers AI free Neuron use/model rights, live OAuth, real prearmed independent Watchdog restore test and cross-operator release exclusion remain unverified. Previous historical UNKNOWN must remain exactly unchanged; no retries or cleanup. Current real six-call smoke **0/6**. Production: **BLOCKED**.
