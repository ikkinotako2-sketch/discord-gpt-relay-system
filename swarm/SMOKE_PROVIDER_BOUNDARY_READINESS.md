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
