# Six-call preproduction cross-source audit — offline, non-authorizing

Created 2026-10-27 in a new stacked Draft PR based on #31 (which depends on #30 → #29 → #28 → #27 → #26 → #25 → #24 → #23 → #21).

## What is implemented
- One pure **read-only** report combining a separately collected Cloudflare Worker+Watchdog GET-only snapshot, D1 fixed-SELECT-only schema snapshot, historical original UNKNOWN-safe-off collector, GitHub Actions/PR-head GET-only snapshot and *numeric-only* Workers AI Free Neuron review.
- Hard reject each missing/untrusted/blocked source, false time, stale >5-minute snapshot, future time, >2-minute spread between five non-atomic sources, wrong Discord account/Worker, baseline not 100%, extra D1 migration objects, missing historical UNKNOWN, running GitHub jobs, previous UTC-day quota and unusable budget upper bound.
- Even with simulated perfect source reports, `CROSS_SOURCE_CONSISTENT_READ_ONLY_NOT_AUTHORIZED` still exposes seven mandatory independent live gates and always reports `authorizesInference=false`, `authorizesDeployment=false`, `authorizesMigration=false`, `authorizesD1Writes=false`, `authorizesWatchdogArming=false`.
- No credentials or raw D1 rows are needed by this pure combiner, and it never drives a Worker/D1/AI API. Offline tests inject only mock previously produced summaries.
- The read-only reports are **not signed** and their source strings are not a cryptographic attestation. This cannot be used by any production launch predicate, and is not wired into production.

## Important limitations
- The D1 audit currently checks schema names and aggregate counters, **not deployed trigger SQL text**. If D1 schema objects are present the combined report fails closed until the definitions, migration, backups and rollback are independently approved and checked.
- The Github collector's Draft-stack pin and reviewed candidate SHA require refresh when new stacked PRs appear. Even a zero-active result is only an instantaneous GET observation, not an account-wide release freeze.
- Existing historical UNKNOWN must remain exactly immutable; `SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN` is never `CLEAN` and never permits inference replay.
- Actual independent Watchdog prearm and live baseline restoration/STOP, signed Discord 401, OAuth+CSRF live owner authorization, model permission and current account-wide Free Neuron reserve remain HARD BLOCKERS.
- Review & merge stacked PRs only after explicit release-scope approval. No remote D1 migration, Cloudflare Worker deploy/flag/Secret changes or AI inference was performed by this PR.

**Production BLOCKED / SAFE OFF; new real inference: 0/6.**
