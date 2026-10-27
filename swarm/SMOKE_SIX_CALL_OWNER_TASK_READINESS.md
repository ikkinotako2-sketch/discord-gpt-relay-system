# Discord six-call: immutable original task from owner D1 (REVIEW ONLY)

This change closes a gap in the staged six-role smoke pipeline: the GPT-OSS provider needs the **original owner task and exact receipt from D1**, not text/flags supplied by a caller.

- `smoke-six-call-owner-task-source.review.sql`: creates a *new* additive task table linked to one owner-bound six-call run. An insert is accepted **only when the run is PENDING and receipt/owner match**, before expiry. Separate SQLite triggers forbid subsequent UPDATE and DELETE. This SQL is **not applied to Cloudflare D1**.
- `smoke-six-call-owner-task-source.mjs`: read-only D1 loader verifies target account/Worker/D1, original owner, run+receipt+claim revision, claimed role 0–5, ACTIVE and STOP=false, absolute expiry and prior-stage output digest. It reads control state again before returning to the staged provider.
- It demands a **separate independently verified fingerprint** for the pre-existing historical UNKNOWN. A bare `true` or owner comment is not sufficient. The test injects only mocked evidence; the live fingerprint verifier and authoritative owner OAuth route are still unimplemented.
- Real local SQLite fault-injection covers six fake provider requests, six claim receipts, six D1 outputs, no seventh, immutable task row, owner STOP between claim and read, missing prior output, and absent historical fingerprint source. Nothing reaches Cloudflare.
- This code alone **cannot authorize inference**. The existing model provider and D1 store still have no production Worker imports. An external AI call cannot be atomically cancelled after STOP arrives.

## Still blocked
Actual production migration/backup/restore approval; owner OAuth+CSRF receipt creation (not supplied here); server-trusted Free account Neuron margin/model entitlement; real pinned live Worker/Watchdog rollback and global release fence; separately scoped live six-call approval. The user's visible Workers request Free quota and account Cron capacity do not certify AI Neuron balance.

**No Cloudflare D1 writes, Worker deploy, Secrets update, AI inference, Free plan upgrade, or legacy UNKNOWN cleanup. Real six-call attempts 0/6.**
