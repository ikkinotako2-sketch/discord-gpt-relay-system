# Staged D1 exact SQL definition integrity — code-only / no live D1 access

2026-10-27, stacked after Draft PR #32 (which depends on #31/#30/#29/#28/#27/#26/#25/#24/#23/#21).

## Security improvement
The prior GET/SELECT metadata auditor verifies 6 SQLite objects only by *name/type*. A maliciously or accidentally weakened trigger (e.g. reserving two calls or removing the six-attempt cap) could pass the prior name-only check. This change retrieves fixed `SELECT name,type,sql FROM sqlite_master`, hashes each `sqlite_master.sql` CREATE statement using SHA-256 and compares against **reviewed, pinned expected digests** derived from the exact staged SQL migration files and Node 22 SQLite.

- All 6 distinct object names and exact types are required, with fixed expected hashes for two tables, two indexes and two atomic triggers. Modified SQL, duplicate rows, missing column, modified stage cap or changed trigger guard => BLOCKED, and the reader does not query claims after detecting drift.
- A completely UNAPPLIED schema still has its own non-authorizing observed status. A partial schema is BLOCKED. Fully matching schema returns `sqlDefinitionsVerified:true` but still only `MIGRATION_OBJECTS_PRESENT_REVIEW_REQUIRED` (or a more restrictive jobs/manual review result).
- Exact hashes attest SQL text in SQLite's `sqlite_master`, not the SQL migration being applied to production, historical D1 data, Cloudflare's database account, deployment freeze or rollback.
- Tests use local SQLite only. Do not fetch API tokens, deploy Worker, apply migrations, write D1, start the watchdog or invoke Workers AI.

## Still blocked in production
Migration remains unapplied to production until an independent backup, rollback and explicit owner approval. Independently attested D1 schema integrity does **not** authorize any model inference or cleanup of the immutable historical UNKNOWN. Need current account-wide Free Neuron allowance/model permission, genuine owner OAuth+CSRF, live Watchdog prearm+restore and cross-operator deployment serialization.

**Status: OFFLINE STAGING. Real six-call test = 0/6; production BLOCKED.**

## 2026-10-28: output receipts migration gap (offline review)

The staged provider/output adapter added `swarm_smoke_control_outputs` after the original six-object audit was written. The earlier reader could report the six control objects as complete without checking whether this seventh output table existed. The revised read-only collector now pins **seven** SQLite DDL definitions, including the output table SHA-256 from local SQLite, and treats the old six-only installation as a **partial migration, BLOCKED**. It also compares aggregate verified claim counts with output receipts and rejects orphan/UNKNOWN-linked, owner-mismatched or malformed receipt-ID rows. It never reads or emits final text, and does not validate the final-text SHA-256 contents remotely.

All checks remain GET/fixed-SELECT-only and offline-tested. A matching seven-object schema is **not** a live migration approval, proof of a current backup, proof of quota, or permission to invoke AI. Production remains safe-OFF; original historical UNKNOWN must remain untouched.

## 2026-10-28: reconcile the owner-task schema introduced by merged PR #39

The prior seven-object proposal still omitted the `swarm_smoke_control_owner_tasks` table and its three immutable owner-task triggers. A seven-object D1 install could be called complete despite having no trustworthy source of the original owner task. The staged SELECT-only auditor now requires **all eleven** exact SQLite DDL definitions: original six control objects, one output receipts table, one immutable owner task table, and three owner task triggers. All eleven exact `sqlite_master.sql` SHA-256 values are pinned. Missing/altered owner-task triggers, absent output table, orphan/mismatched owner receipt, and ACTIVE or claimed runs without owner tasks are **BLOCKED**. Aggregated counts only; no owner task content or token is exposed.

These SHA-256 values are from local SQLite's proposed review SQL; no Cloudflare D1 migration was executed. The original historical UNKNOWN is not modified. The live production D1 schema remains UNAPPLIED according to the last read-only snapshot, which is not fresh enough to authorize a launch. No inference, deployment, flag change or Watchdog POST is approved by this PR. PR #40's separately drafted historical UNKNOWN D1 verification is also **not** live-wired or merged.
