# Six-Agent Swarm — Isolated Staging

STATUS: **OFFLINE / NOT CONNECTED TO PRODUCTION**

This branch extends the existing Discord GPT Relay Lab. Nothing modifies the existing A→B→A→B production relay, Cron, Secrets, Worker, D1 schema, OAuth, or Project Love Machine.

- Six **sequential roles**, NOT six browser ChatGPT sessions: director, researcher, developer, reviewer, improver, archivist.
- One inference per claim via a future authorized model adapter. Up to three improvement cycles = 18 model calls max. Never an unlimited loop.
- Every committed step stores history and a checkpoint. Missing provider quota BEFORE inference may move an unclaimed task to quota_wait; resume requires capacity to return legitimately.
- Uncertain inference or expired lease becomes unknown; **no blind automatic retry**.
- One active swarm task globally. STOP is cooperative and rejects in-flight results.
- No autonomous account changes, real SNS publishing, payments or releases. Free tier may limit how much work runs.

## Owner steps before live use

1. Verify latest Discord /loop-status is terminal, no other job is active.
2. Add DISCORD_OAUTH_CLIENT_SECRET and DASHBOARD_COOKIE_KEY to the dedicated Discord Worker, not to this public repository or chat. Register the documented Discord OAuth redirect.
3. Obtain separate approval for the new swarm/schema.sql migration on discord-relay-loop-state only.
4. Add an OAuth-authenticated, CSRF-protected dashboard API and an exact adapter for Workers AI, then confirm preflight quotas, budget and one-step Cron claims.
5. Run one end-to-end real-inference task and test STOP, durable resume, duplicate prevention and errors. Require separate approval for production.
6. Always mark the web demo as DEMO until D1-backed roles are live.

Test offline: node --test swarm/engine.test.mjs (Node 22+).

Branch contains only swarm/** additions. Do not merge or deploy automatically.

## Conservative daily call reservations (staged)

The optional Cron adapter in `swarm/cron.mjs` requires four independent opt-in flags (`SWARM_API_ENABLED`, `SWARM_RUNNER_ENABLED`, `SWARM_EXECUTION_APPROVED`, `SWARM_EXCLUSIVE_MODE`) and an explicit `SWARM_DAILY_CALL_CAP` of 1..18. It atomically reserves each inference against a local UTC-day budget before claiming work. This is **not** a Cloudflare quota inquiry or a guarantee of zero billing; it is a deliberately conservative local safety guard. No Cron hook is currently wired. Each unconfirmed inference remains terminal `unknown` rather than being retried.


## 2026-10-12 — stacked exclusive wiring PR #6 (offline-only)

The Draft stacked PR adds the link between the six-role runner and the existing Discord Worker (while preserving the live two-role command handler):

- Read-only six-role dashboard URL is routed when `SWARM_API_ENABLED=true`; private Discord OAuth remains mandatory. It is otherwise unavailable.
- AI execution is enabled **only** if all four explicit flags are exactly `true` and a local `SWARM_DAILY_CALL_CAP` of 1..18 is set. No flags are enabled by default. The account's actual Neuron usage remains unverified.
- Cron drains one existing legacy step first. Only after a verified idle result and D1 COUNT=0 can a single six-role stage be attempted. No parallel model inference on the same tick.
- Slash `/loop` and the original owner dashboard's new-task endpoint reject legacy task creation during explicit six-role exclusive mode; the old STOP/status actions remain available.
- Six-role task creation refuses to proceed with an active legacy task or without a local daily cap. Missing/unreadable tables are treated as BLOCKED, not automatically migrated.
- **Not yet merged or live.** Exact Discord-only D1 migration, free-budget acceptance, run activation flags and future production deployment all require **separate, explicit owner approval**, after confirming existing YouTube/Project Love Machine workflows are unaffected.
- Tests are offline mock/SQLite only; do not treat their PASS as a real Cloudflare AI inference success. The earlier production 2-role `MODEL_ERROR` has not yet been diagnosed at provider-error granularity.
