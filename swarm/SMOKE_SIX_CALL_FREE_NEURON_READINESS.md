# Discord six-call — account-wide Free Neuron capacity & prelaunch report

**2026-10-26: CODE/OFFLINE ONLY. No production API wiring, Cloudflare D1 writes, inference or deployment.**

This stacked branch depends on Draft #27 → #26 → #25 → #24 → #23 → #21. No standalone merge into main.

## Verified public rule (not account-specific availability)
Cloudflare Workers AI documentation, updated 2026-10-01:
https://developers.cloudflare.com/workers-ai/platform/pricing/
- Free allocation: 10,000 Neurons/account/day, reset **00:00 UTC**.
- Exceeding allowance on Workers Free can cause errors; **some models require paid billing**. Catalog availability is subject to change.
- A current account-wide **Workers AI dashboard** measurement is needed for balance. Generic GraphQL Workers request counts, yesterday's usage, or a D1 local 6-call cap are not sufficient to establish real Neuron capacity.
Cloudflare Workers Free 5 cron triggers/account:
https://developers.cloudflare.com/workers/platform/limits/

## Staged code
- `smoke-six-call-free-neuron-review.mjs`: calculates a *necessary, non-authorizing* Free-capacity upper bound for exactly six calls using independently reviewed current-UTC-day **account-wide** Neurons and additional concurrency reserve. Rejects missing/fractionally malformed/negative/stale metrics, wrong account/day, incomplete coverage, other AI activity, wrong model, and insufficient margin.
- The worst-case per-model Neuron estimate is NOT produced by this code, and the reviewer **cannot** verify whether external dashboard values have been accurately transcribed. Even a numerically plausible margin returns `REVIEW_ONLY_NUMERIC_MARGIN` with `realProviderQuotaVerified:false`, `modelPermissionVerified:false`, and `authorizesInference:false`.
- `reviewWorkersAiGraphqlNeurons` deliberately treats GraphQL 200 / request counts / previous-day sum as **UNVERIFIED**. It never invents a current account balance.
- `smoke-six-call-readiness-report.mjs`: joins non-atomic read-only safe-OFF audit (which preserves original UNKNOWN), quota reviewer, current GitHub Actions run-count evidence, exact reviewed SHA and stacked Draft PR review. It always keeps live hard blockers such as schema migration + backup, new explicit owner live approval, cross-operator release freeze, independent Watchdog actual prearm and restoration, provider model permission and actual provider-wide quota reservation.
- No current Cloudflare credentials, provider-side usage, or OAuth session is accessed; all tests use offline data only. No secret should be added to GitHub CI.

## Prelive flow (requires new scoped owner approval at real production change point)
1. Independently review and merge the Draft dependency chain in order under one approved scope. No direct unreviewed main merge.
2. Read fresh real Cloudflare D1+Worker+independent Watchdog safe-OFF state, review exactly one unchanged historical UNKNOWN and zero active jobs. No earlier-day evidence reuse.
3. Independently confirm the actual **account-wide current UTC day** Workers AI Neuron tally, reserved margin for the selected model and six worst-case attempts, unrelated AI idle and Free/model entitlement. A numeric local check is **not** a provider-side reservation.
4. Live-test independent prearmed alarm/rollback and postrestore baseline/flags+signed 401; serialize **all** operators including Dashboard/Wrangler/other CI, not only local DO fence.
5. Obtain separately scoped new owner consent for any migration, deployment and up to six model calls. No inference on an ambiguous claim/settlement; do not modify original historical UNKNOWN.

**Status: offline review only, production BLOCKED, actual new smoke 0/6.**
