# Reviewed owner task registration — offline-only (2026-10-28)

The reviewed six-call pipeline has a PENDING owner review record and an immutable owner-task D1 table, but previously **no staged authenticated registration adapter** to populate that table from a server-reviewed task. This change fills that code gap without connecting the production Worker.

- `handleSmokeReviewedTaskRegister()` is a staged, **non-imported** endpoint. It verifies a signed Discord dashboard OAuth session, exact allowed owner ID, Origin, CSRF and same-site request. It accepts **only** `{ "intent": "REGISTER_REVIEW_ONLY_TASK", "runId": "..." }`; any text, model, launch/approval flag, consent or extra input is rejected.
- It reads an existing bounded PENDING run; requires zero claims, STOP=false, exact account/Worker/D1, same owner and receipt, and <=20-min expiry. Original task comes **only** from a separately provided trusted server callback (not browser JSON) and must match this task receipt.
- It uses one D1 `INSERT INTO owner_tasks … SELECT FROM control_runs … RETURNING` so changes in STOP/phase/owner/revision between review and insert fail closed. On any ambiguous D1 write, it never retries; after success it SELECTs exact stored task to confirm an immutable receipt. D1 review SQL disallows future UPDATE or DELETE.
- The endpoint's 202 response, and all errors, set authorizesInference/Deployment/Migration/Watchdog/LiveActions to **false**. The review task is NOT the separate owner consent needed for production deployment, migration or 6 Workers AI calls.
- Real local SQLite tests use existing OAuth/HMAC helpers with **fake signing secrets**, not real Cloudflare, and cover forged session, Origin, CSRF, wrong run/owner, malicious task JSON, STOP races, expired pending, duplicate calls, missing schema, immutable historical UNKNOWN and no attempt reservation.

**Not done:** No production Worker import/route, no real D1 schema apply or owner task INSERT, no production backup/restore, no independent Watchdog live restore, no model/Neurons proof, no signed live authorization. The current 11-object migration remains unapplied. Real model calls 0/6. Free plan unchanged.

## Async callback clock regression (review-only)

The request-entry clock precedes `await loadServerReviewedTask`. A genuinely
server-reviewed attestation stamped during that await can be later than the
request-entry timestamp. Validation now uses a second, monotonic post-await
clock (at most 30 seconds after entry and strictly before run expiry), then
requires the trusted attestation timestamp to be no later than that clock and
no older than five minutes. Local SQLite regression checks t+100ms accepted
at post-await t+120ms, while t+121ms is rejected with no task insertion.
This does not enable a production route or provide launch authority.
