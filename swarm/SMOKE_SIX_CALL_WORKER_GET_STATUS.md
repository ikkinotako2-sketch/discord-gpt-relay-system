# Cloudflare Worker + independent Watchdog GET-only audit

Staged on 2026-10-27. Based on Draft PR #30 → #29 → #28 → #27 → #26 → #25 → #24 → #23 → #21. **Not imported into the deployed Worker. No live Cloudflare request is made in CI.**

## Fixed-scope read-only checks
- Pinned Discord-only account/Worker/D1 and baseline version, one live deployment pinned at 100%, same deployment ID before and after the read sequence.
- Cross-check both deployed version *and* current remote settings for exactly one dedicated `LOOP_DB` binding and four SWARM flags absent or plain_text `false`; fail on duplicates, shadow D1 bindings, partial traffic or any unsafe flag.
- Verify independent Watchdog configuration PARKED (`WATCHDOG_ARMED=false`, `WATCHDOG_APPROVAL=NOT_APPROVED`, version and expiry UNSET), one matching Cron schedule, and required secret **names only**. No secret values are collected or serialized.
- Fail on invalid Cloudflare HTTP/JSON shape, stale/clock-rollback reads, mixed deployments or drift between the two GETs.
- All statuses are **non-authorizing**. Even `WORKER_AND_WATCHDOG_PARKED_GET_REVIEW_ONLY` explicitly has `independentRollbackLiveTested:false`, `cloudflareD1JobsRead:false`, `signedDiscord401Verified:false` and `accountWideNeuronsVerified:false`. Credential presence does not attest scope or entitlement.

## Work still blocked
Fresh separate GET/SELECT proof is required from real Cloudflare, along with model availability/account-wide Free allowance, an independently live-tested baseline restore and Watchdog durable alarm (and operational freeze of Dashboard/Wrangler/other CIs), new explicitly authorized owner OAuth action, migration backup/restore, and preservation of original historical UNKNOWN. No prior review constitutes a live launch approval.

**No merge, actual AI 0/6, no D1 migration/write, no Secrets/flags change, no Worker deploy, no Watchdog arming, no YouTube or PLM modification. Production remains BLOCKED.**
