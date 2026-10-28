# Discord GPT Relay: staged six-call Workers AI provider adapter (2026-10-27)

This patch narrows the remaining integration gap between the reviewed six-call controller/D1 ledger and the actual Cloudflare Workers AI binding. **It is code-only and NOT imported by `worker-relay.mjs`, `worker-loop.mjs`, Cron or any deployed production route.**

## What this adds
- A single future `provider.invoke({runId,taskReceiptId,stageIndex,claimRevision})` capability compatible with `runSixCallStep`, **never** granting consent by itself.
- Exact model `@cf/openai/gpt-oss-20b`, six server-selected roles, `max_tokens:360`, `reasoning_effort:low`, limited prompt sizes and output size. No fallback to paid/other models, no automatic retries, no task/secret output logs.
- Fail-closed unless the future adapter's environment has **all four** SWARM flags explicitly ON, `SMOKE_AI_PROVIDER_ENABLED=true`, `SMOKE_PINNED_MODEL` exact, `SWARM_DAILY_CALL_CAP=6`, an absolute <=20-minute expiry and the expected Discord owner ID.
- The future caller must load the *original signed/owner-bound task* from trusted D1, not JSON submitted by a browser. The adapter verifies its run, owner, receipt, stage, claim revision, expiry and final-stage ordering.
- The future caller must **persist the bounded confirmed output into D1 and read it back**, returning a digest/receipt proof; a missing/mismatched/uncertain D1 result causes an exception, which the already claimed controller must settle as terminal UNKNOWN.
- A local SQLite test exercises genuine six atomic claims, six fake AI model calls, six output receipts, local free reservation 6/6, RESTORE_REQUIRED, and a seventh invocation blocked. No Cloudflare AI, D1 or billing call in CI.
- Other tests inject expired config, missing binding, failed output read/commit, unexpected AI response and owner/receipt mismatches.

## What is still missing before production
1. A **production-integrated authenticated owner task record** with an immutable owner receipt and verified output persistence schema (the test has a LOCAL-ONLY table; it is NOT part of the review-only production D1 migration).
2. Real independently verified provider Free plan Neurons / model entitlement (account Workers request 1,681/100,000, Cron 2/5 and AI binding installed do not certify Neurons). Existing model-catalog GET returns 403/10000 with the current API token.
3. Reviewed, backed-up and explicitly authorized D1 schema deployment; independent armed watchdog with real rollback proof; exclusive Dashboard/Wrangler/GitHub release; valid owner OAuth+CSRF and one-time max six attempt release approval.
4. Live wiring from approved Worker runtime to controller, including capability names and committed output receipts. This file cannot be used in place of those missing gates.

**Status: Offline mock model only. Real AI calls 0/6; production remains SAFE OFF. No paid plan or account changes.**

## 2026-10-28 staged asynchronous D1 task timestamp correction (review-only)

**Root cause:** `provider.invoke()` sampled `now` before awaiting the owner D1 task loader. The loader creates `checkedAtMs` only *after* an asynchronous D1 read, but `acceptedJob` previously compared that later timestamp with the **earlier** provider-entry `now`. An ordinary valid task could be rejected as "future" after a durable claim, leaving a terminal UNKNOWN without ever invoking the fake provider.

**Fix:** sample a second monotonic provider clock immediately after `loadVerifiedTask`, verify the exact environment and absolute expiry again, require the elapsed read window to be 0..30 seconds, and pass **that post-load timestamp** to `acceptedJob`. The task's `checkedAtMs` must be no later than the post-load clock and at most 30 seconds old. An actually future task stamp, clock rollback, delayed read, expiry, missing flag or forged owner/receipt still fails closed before any model call. No retries or expanded inference permission.

**Regression:** simulated asynchronous owner D1 timestamp t+100ms and provider post-load t+120ms must produce one **fake** AI call and one receipt; a task stamped after t+120ms and a 31-second loader delay both must result in zero model calls. The old provider fails the legitimate t+100ms case. The staged production Worker does not import this provider, and this PR does not merge any pending D1/UNKNOWN drafts.

**Still blocked:** real historical UNKNOWN full-row independent pin, live D1 backup/migration/restore approval, authenticated owner task creation, live-tested independent Watchdog rollback, current account-wide Free Neurons and pinned model rights, external release exclusion, and explicit bounded owner authorization. **No Cloudflare API writes, production deploy, real AI, paid plan or historical UNKNOWN retry.**
