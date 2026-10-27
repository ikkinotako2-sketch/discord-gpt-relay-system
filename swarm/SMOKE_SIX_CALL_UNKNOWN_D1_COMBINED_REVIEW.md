# Combined review of Draft PR #40 + Draft PR #41 — OFFLINE ONLY

## Provenance and merge policy

This branch was forked from exact [PR #41](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/pull/41) HEAD `be1c8373fba50fef5d2aa44380364ee332e5f2b8` and copied only the original historical UNKNOWN reader and local tests from exact [PR #40](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/pull/40) HEAD `ee6b97ed6dc58fad457d66b1023c2e5769df27b5`. The two overlapping workflow allowlists and the central offline isolation guard were explicitly reconciled, not blindly overwritten. No production runtime or live workflow changed.

The exact diff against `main=36e2d5900ebca2263ac629a0f325ec774cd280a2` must contain exactly these **14 review-only files**: 11 from PR #41, the 2 original owner task reader/test files from PR #40, and this document. Both existing offline CI workflows and the central isolation guard fail closed if the PR scope changes. This branch is for review, not an instruction to merge either original draft or deploy.

## Invariants retained together

- Full-row independent historical UNKNOWN pin: immutable snapshot of original run/owner/SHA-256 of all 17 persisted columns, twice verified by D1 SELECT. A missing independent pin, replaced row, altered same-length text, oversized duplicate, or STOP during the read denies model calls. **The real original production digest is NOT in this repository; mock pins do not establish live historical integrity.**
- Complete 11-object D1 schema pin: six control objects, output table, original owner task table, and three immutable-task triggers. Read-only D1 counts check claims, receipt identity/revision/timing and owner-task consistency. A bounded readback verifies SHA-256 of stored output content. **No production D1 migration was performed**.
- Fake provider only; local SQLite six-stage tests check no seventh, no retry on UNKNOWN and no bypass of STOP.
- Source labels and booleans from offline mocks cannot authorize live inference, deployment, migration, watchdog arming, or billing. Production Worker entrypoints remain unmodified.

## Remaining hard blockers

1. Separately retained original production historical UNKNOWN identity and full-row digest (independent of any current D1 query).
2. Explicit owner approval for production D1 backup, migration and tested restore, followed by fresh read-only 11-object schema/receipt verification.
3. Owner-authenticated OAuth+CSRF original task creation and receipt, independent release fencing, live-tested prearmed Watchdog restore, and bounded live six-call authorization.
4. Current account-wide Workers AI Free Neurons remaining **and** pinned model entitlement. Cron/Worker requests and AI binding are not Neuron entitlement evidence.
5. New execution-day Cloudflare read-only Worker/D1/Watchdog state; old snapshots are not sufficient.

No D1 writes, Cloudflare Worker deployment, SWARM flag ON, Watchdog POST, Secrets or API token changes, real AI inference, billing, YouTube/PLM changes, or historical UNKNOWN retry. **Real six-call attempts remain 0/6.** Any release action remains **BLOCKED** until separately authorized and independently verified.
