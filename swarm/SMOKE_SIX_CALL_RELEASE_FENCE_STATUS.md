# Staged one-shot release fence (2026-10-26) — no live authority

This branch is stacked after #26 (which depends on Draft #25, #24, #23, #21). This component is **not deployed or imported by production**.

## One-time serialization within the dedicated DO
- A dedicated durable storage transaction stores an immutable exact Discord account/Worker/D1+baseline/smoke version pair, owner review receipt, reviewed Git HEAD and absolute <=20-minute expiry.
- Exactly one `reserveOnce` can persist for a dedicated DO; even after expiry a second attempt is denied. There is deliberately **no reset/retry method**. Failed/uncertain deployment may be marked `UNCERTAIN` and cannot be made active again automatically.
- The `inspect` method rejects wrong versions/owners/HEAD/deadline, expired lease, missing storage and uncertain results. Both operations return `authorizesDeploy:false` and `authorizesInference:false`.
- The module does **NOT** sign owner approvals, provision the DO namespace, deploy a Worker, use Cloudflare tokens, run a model, write live D1, or operate Watchdog. Tests simulate a serializable DO storage transaction and run in Github CI only.
- Explicit `releaseLockIsGlobal:false`: This DOES NOT stop an operator using a separate Cloudflare Dashboard, Wrangler, or other CI integration. Consequently, a genuine runtime coordination/freeze of **every** writer plus independent live reconciliation is still essential. Cloudflare deployment REST GET/POST lacks atomic compare-and-swap.

## Before live release (still BLOCKED)
- Independent review/ordered integration of draft PRs, exact scoped approval for any Worker/D1 migration or deployment.
- Verified production DO namespace and durable one-shot receipt, independently validated prior to a traffic switch; no browser-supplied model/permission flags.
- Live signed Discord/OAuth+CSRF and rollback verification; original UNKNOWN unchanged; independent Watchdog alarm persisted BEFORE deployment; release lock held against *all* operator paths, not just this DO.
- Fresh Cloudflare provider-account Free Neuron margin, model entitlement, cron slot, D1 snapshots and absence of other running actions.
- Post-restore remote flags OFF, primary version pinned 100%, signed unauthorized Discord POST returns 401, old/new D1 job states audited. Uncertain POST or in-flight model = BLOCKED/manual recovery/no automatic retry.

New confirmed real 6-agent attempts: **0/6**. Nothing here authorizes live AI or a deployment.
