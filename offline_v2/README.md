# Discord GPT Relay System — V2 offline harness / loop / graph
**REVIEW ONLY — no production import, execution or deployment.**

This PR is a minimal standalone V2 proposal inside `offline_v2/`. The six **runtime** sequential roles are already staged in `swarm/engine.mjs`: director, researcher, developer, reviewer, improver, archivist. The real once-only six-call controller is in `swarm/smoke-six-call-controller.mjs`, with STOP and UNKNOWN no-retry. V2 roles here (researcher, designer, implementer, tester, auditor, manager) are *logical engineering roles*, not six new bots; they do not modify the existing six-call order.

## Harness
`core.mjs` uses fixed least-privilege role tool allowlists (read, plan, isolated-branch editing, offline testing, draft PR). It never permits deployment, D1 writing, Secret editing, external model inference or self-approval. Caller/model-provided fields are never owner authorization; only existing independently authenticated OAuth+CSRF and explicit scoped consent can authorize a separate live operation.

## Graph
A structured handoff must contain *exactly* task_id, run_id, from_role, to_role, objective, artifacts, evidence, constraints, current_status, next_action, approval_required. Allowed logical handoff: manager → researcher → designer → implementer → tester → auditor → manager. The output is immutable and explicitly non-authorizing. References are short digests and repository paths, not copies of chat histories, prompts, tokens or raw logs. An unrecognized graph edge or injected permission field is blocked. Production's `swarm/handoff.mjs` is unchanged.

## Loop and events
Allowed event kinds include CI_FAILED, ISSUE_OPENED, PR_UPDATED, TEST_CHANGED, APPROVAL_CHANGED and WATCHDOG_ANOMALY; only a verified CI_FAILED test assertion is eligible for bounded *offline* repair. A test-scope protection failure, credential failure, quota failure or approval event never triggers automatic edits. The stable event key includes exact repository, source ID, revision and pinned HEAD. `store.claimOnce` and `store.finish` are **injected mock interfaces**; no persistent store is included and no claim of live D1 atomicity is made. The offline retry cap is **2** as a deliberately conservative staging assumption, pending measurement. It is wholly independent of the live 6-inference-attempt limit, whose actual state remains untouched. Unknown claims and uncertain settlement are terminal, with no blind replay.

## Reuse and integration
Earlier Draft [#50](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/pull/50) contains a separate deterministic classification experiment; it remains Draft and has protected-scope CI failures. This V2 proposal neither imports nor duplicates that classifier. Integrating the drafts requires a separately reviewed exact diff. Existing scheduled monitoring is reused; this PR does not create another automation, add a live webhook, register a Discord bot or invoke a model. Unlike the mocked event pipeline, real event-origin verification and globally unique durable release fences are **not** established here.

## Verification
Run `node --test offline_v2/core.test.mjs` on Node 22. Dedicated `.github/workflows/discord-v2-offline.yml` restricts PR to exactly five reviewed paths, has read-only permissions, performs syntax checks, executes offline tests and the existing six-call controller regression, and asserts the new module is not imported by production. No deploy/Secrets/D1/AI commands are part of this PR.

## Live release blockers (unchanged from Issue #22)
Independent original UNKNOWN full-row pin; current account-wide Free Neurons balance and exact model permission; verified D1 backup / migration / restore; actual owner OAuth+CSRF with server-trusted original task; independently prearmed Watchdog and proven rollback; release exclusion, emergency STOP and separate scoped consent. Any missing evidence means BLOCKED. **Actual six-call model tests remain 0/6 per last known audit, not a live measurement.** No changes to Cloudflare, Discord, PLM, Gamee or any billing occur in this proposal.

Cost and time: local Node tests involve no paid AI calls. GitHub CI minutes/storage may count toward its plan. No 90% saving, provider-wide free allowance or finish time is claimed without current measurement.
