# Discord GPT Relay V2 — repository runbooks, not installed provider Skills

These eight repeatable runbooks are **review-only** and apply solely to `ikkinotako2-sketch/discord-gpt-relay-system` and Issue #22. A Skill's tool names are proposals, not tokens or live execution authorization. All require the original UNKNOWN to remain unchanged, a functioning independent Watchdog, emergency STOP, maximum six real AI attempts, free-cap verification and separately scoped owner consent for live operations.

## 1. GitHub CI failure analysis
- **Trigger:** A new failed job on a pinned PR HEAD.
- **Inputs:** Repository, exact SHA, PR, run, job and sanitized logs.
- **Allowed tools:** GitHub read-only commit/PR/CI/log APIs.
- **Procedure:** Confirm SHA, fetch failed job once, classify test/scope/auth/quota/unknown.
- **Verification:** Run conclusion and exact stack location match the current HEAD.
- **On failure:** Missing or contradictory evidence → BLOCKED; no blind rerun.
- **Approval:** Read-only none; security-policy alterations need independent approval.
- **Output:** STATUS, diagnostic category, trace link, next safe action (never raw secret).

## 2. Bounded safe code repair
- **Trigger:** Verified offline defect within reviewed path scope.
- **Inputs:** SHA, regression reproduction, explicit allowed paths, attempt budget.
- **Allowed tools:** Isolated GitHub branch/file changes; offline local tests.
- **Procedure:** Add regression, minimal patch, inspect exact diff, repeat at most twice for confirmed ordinary test failure.
- **Verification:** Exact HEAD, no production import, independent reviewer and passing tests.
- **On failure:** Unknown writes or exhausted cap → BLOCKED, no force push.
- **Approval:** Protected PR merge, production changes and security scope overrides require owner authorization.
- **Output:** Branch, commit, paths, attempt counts, tests and unresolved blockers.

## 3. Offline tests and fault injection
- **Trigger:** New staging patch or code dependency change.
- **Inputs:** Test command, fixed candidate SHA and baseline assertions.
- **Allowed tools:** Node 22 local tests; read-only Actions results.
- **Procedure:** Run syntax/tests, duplicate-claim, expiry, STOP, unknown and missing-permission cases.
- **Verification:** Local PASS/FAIL counts separately from exact-head CI runs.
- **On failure:** Investigate; do not mark mocks as live proof or skip required checks.
- **Approval:** None for offline-only tests.
- **Output:** Test totals, failing IDs, runtime and evidence links.

## 4. Security audit
- **Trigger:** Any changes to permissions, workflow files, handoffs or identity fields.
- **Inputs:** Reviewed diff, role allowlist, Issue #22 constraints.
- **Allowed tools:** Static code review, mocked adversarial tests, GitHub metadata read.
- **Procedure:** Challenge cross-repo edits, role escalation, forged approval, secret logging, path traversal and UNKNOWN replay.
- **Verification:** Independent deny-case tests and exact changed-path review.
- **On failure:** Unsafe change → FAIL/BLOCKED without merging.
- **Approval:** Any new live capability or credential scope needs distinct approval.
- **Output:** Findings, affected lines, safe alternatives, no-live evidence.

## 5. Cloudflare safe read-only audit
- **Trigger:** Current release gate or meaningful Worker/D1/Watchdog status change.
- **Inputs:** Exact intended account/Worker/D1, approved GET/SELECT credentials, baseline version.
- **Allowed tools:** Authorized Cloudflare GET and D1 SELECT only.
- **Procedure:** Compare safe-OFF flags, Watchdog parked state, D1 schema and historical count without exposing tokens.
- **Verification:** Independent original UNKNOWN pin, timestamp and authentic account-wide AI remaining capacity; distinguish Workers requests from AI Neurons.
- **On failure:** API 403, stale or incomplete evidence → BLOCKED.
- **Approval:** Any D1 write, migration, deploy or real Watchdog POST needs separate scoped consent.
- **Output:** Time-stamped proof, resource IDs redacted as appropriate, missing gates.

## 6. PR review gate
- **Trigger:** Draft with a complete tested diff.
- **Inputs:** Base/head SHA, exact changed paths, CI checks, reviewer decisions.
- **Allowed tools:** GitHub read-only PR/review/status; approved issue comments.
- **Procedure:** Check protection policies, redundant implementations and conflict with other drafts.
- **Verification:** All required exact-head CI success, independent scope/owner review.
- **On failure:** A single required check FAIL keeps PR Draft and BLOCKED.
- **Approval:** Protected PR integration requires explicit approval.
- **Output:** Merge/hold recommendation with evidence, never implied merge success.

## 7. Incident and rollback preparation
- **Trigger:** UNKNOWN, STOP, Watchdog anomaly or disputed live baseline.
- **Inputs:** Immutable old evidence, original UNKNOWN digest, baseline version and STOP state.
- **Allowed tools:** Read-only incident diagnosis, offline mock restoration.
- **Procedure:** Preserve evidence, prohibit retries, inspect release lock, exact rollback plan and out-of-band emergency stop.
- **Verification:** Independent offline assertions and separately authorized real restoration checks.
- **On failure:** Incomplete rollback proof → BLOCKED; no blind repair.
- **Approval:** Real Worker/D1/Watchdog mutations require per-operation owner consent.
- **Output:** Incident STATUS, manual recovery prerequisites, verified vs not verified.

## 8. Progress, cost, ETA and notification
- **Trigger:** Verified change, owner request or actionable approval dependency.
- **Inputs:** Current HEAD, CI attempts, elapsed time, provider usage and owner approvals.
- **Allowed tools:** Read-only GitHub, existing scheduled monitoring, local calculations.
- **Procedure:** Compare measured task time and costs, map dependencies, notify only meaningful changes.
- **Verification:** Every PASS has evidence; offline test results never imply production readiness.
- **On failure:** Insufficient hours/quota/cost data → ETA unknown, remaining budget unverified.
- **Approval:** Notification cannot trigger release or provider inference.
- **Output:** STATUS, step progress, confirmed counts, blockers, ETA assumptions and owner action.
