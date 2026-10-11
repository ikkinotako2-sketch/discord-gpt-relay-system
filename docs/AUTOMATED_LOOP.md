# Stage 2 — Bounded multi-agent loop (2026-10-11)

## What is now implemented on GitHub

- `loop-core.mjs` exports `runBoundedLoop`. It executes **two consecutive AI-agent rounds** automatically: planner → builder → planner(reviews the previous builder output) → builder.
- The number of rounds is explicitly capped at **1 or 2** (maximum **4 model calls**). The final status is `stopped_at_round_limit`.
- `shouldStop` is consulted before each model call. If true, the run stops with `stopped_by_request`. **This is only a cooperative in-memory stop callback, not an externally exposed STOP button.**
- Invalid tasks, identifiers, overly large outputs, and model failures stop processing. **No retries or autonomous external actions.**
- `loop-worker.mjs` optionally plugs in Cloudflare Workers AI using existing provider-neutral `generate` contract.
- `worker-relay.mjs` now passes the previous builder output to the next planner **as untrusted reference material**, without changing current single-pass `/relay` behavior.
- GitHub Actions run `38143216065`: **28/28 tests PASS**, no Cloudflare deployments.

## What is *not* yet implemented

- No `/loop` slash command, queue, schedule, persistence, or continuous background running yet.
- The stage-2 code is in GitHub only. Production Worker remains the separately verified latency-v1 version `f50669d7-7685-4da1-b2e5-567ae7526922` and still runs single-pass `/relay`.
- Four sequential Workers AI calls inside one Discord callback could exceed Cloudflare Workers / Discord interaction lifetimes. **Do not simply expose `runBoundedLoop` directly via the live slash command.**
- This is a Cloudflare Llama-model loop, **not** automated ChatGPT web chat sessions or GPT API access.
- GPT provider support requires an official authorized API integration and its cost/usage requirements. No ChatGPT subscription grants an OpenAI API key for free.
- Never claim infinite or unattended perpetual execution, and never auto-publish to external services.

## Next implementation stage: durable, explicit, bounded Discord runs

Use a **new** Cloudflare D1 database scoped to this Discord project, never the Project Love Machine D1 instance. Deploy only after separately verifying account, Worker, new database and token permissions.

1. `/loop task:<text>` authenticates the Discord interaction, enforces an operator allowlist and a per-user active-job cap, inserts a single `queued` job with `run_id`, `requester_id`, `round_target<=2`, `calls_used<=4`, and returns a fast acknowledgement.
2. A Cloudflare scheduled Worker / queue worker claims one bounded step per invocation; use a database transaction or conditional update for the lease to prevent duplicate claims. Do not attempt an uninterrupted four-inference request.
3. Persist the outputs and next role/round after each completed model call; use bounded output size, an expiry time, a total call budget, and explicit states `queued/running/completed/stopped/failed/unknown`.
4. Unknown outcomes must **not** be retried blindly. In particular, reject duplicate model calls if completion is ambiguous; log metadata only, never secret tokens or public user text.
5. `/loop-status` and `/loop-stop` verify requester/operator authorization and only read or request stop for that run. STOP is checked before each new model call.
6. Notify via a valid Discord delivery method and redact user inputs from logs. Retain only necessary data with expiration and deletion.
7. Run local mock/state tests, then a **single user-authorized** staging test, then a separately confirmed production release with rollback. Keep existing `/ask` and `/relay` working.

## Boundaries and cost

- Default to Cloudflare Workers AI free usage **only within actual quotas**; stop on quota errors, do not charge, and do not bypass quotas with extra accounts.
- Keep one active experiment and at most four model calls until real reliability and latency metrics are reviewed.
- Cloudflare and Discord account permissions, API tokens and webhooks stay in secrets, never in the public repository.
