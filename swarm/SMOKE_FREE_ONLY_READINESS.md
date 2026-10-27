# Discord GPT Relay — Free plan only: evidence / activation boundary (2026-10-27)

This package is **OFFLINE, READ-ONLY FROM PRODUCTION**, and does not require upgrading Cloudflare. It does not install a token, enable any paid service, deploy a Worker, run Workers AI, or update D1. The supplied JS never grants runtime permission.

## Official rules and pinned model

- Cloudflare Workers AI Free currently includes **10,000 Neurons per account per UTC day**, reset at 00:00 UTC. Running out fails on Free rather than silently billing an unused upgrade: https://developers.cloudflare.com/workers-ai/platform/pricing/
- `@cf/openai/gpt-oss-20b` has public planning prices **18,182 Neurons / million input tokens** and **27,273 Neurons / million output tokens**. Prices can change and should be rechecked before live approval. This model is not on the current documented paid-method-only exception list; the user's actual model entitlement is **still UNVERIFIED**.
- `swarm/runner.mjs` has `max_tokens:360` per model request, but this does NOT measure hidden reasoning billing, current input token counts, or concurrent account usage. The new pure planning function accepts hypothetical measured input caps, an output overhead multiplier and a separate reserve; it **never claims an actual provider-billed upper bound**.
- **Never** infer available capacity from a missing Cloudflare GraphQL group, one earlier-day sum or an empty D1 budget row. A local six-call cap is not a server-side Neuron reservation.

## Live checks already performed using existing credentials (no cost)

1. [Token verify + catalog check](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/40504795877): token is **active**, model catalog endpoint HTTP **403**, error code **10000**. This signals the GET token is not authorized for that endpoint; it does not prove the model requires a Paid plan.
2. [Token policy GET](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/40505106254): active token; policy details endpoint HTTP **403**. Do not claim Workers AI Read/Write is present based on token activation alone.
3. [Account usage GET](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/40505516164): HTTP **403**, so no account balance established.
4. [GraphQL Free Neurons](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/40502494732): HTTP 200 but today has no `totalNeurons` row. Usage and remaining allocation remain **UNVERIFIED**.

## One owner action when ready (NO billing upgrade)

Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> custom token:
- Scope to the **existing Discord Workers AI Cloudflare account**, with **Workers AI: Read** for a catalog-only diagnostic (not the Write permission unless later independently approved for a genuine authorized model request).
- Do NOT set Billing edit permissions, paid products, paid plan, AI Gateway credits, account-wide wildcard rights or administrator roles for a read-only check.
- The owner must save an approved diagnostic token using an appropriate secret manager; do not paste it into GitHub Issues, public logs, pull request text, ChatGPT or Discord. An existing generic token used for Worker/D1 reads should not be casually overwritten.
- Real dashboard current-UTC-day **account-wide Workers AI Neurons**, model entitlement, absence of other Workers AI jobs and a verified launch margin are still required. A token scope change alone does not settle remaining quota.

## Explicit remaining BLOCKED steps
- Real D1 backup, approved proposal SQL migration, verified rollback and old immutable historical UNKNOWN unchanged.
- Independent prearmed Watchdog **proven restoring** the baseline + remote flags OFF + signed unauthorized Discord request rejected with 401.
- Exclusive external release access across Dashboard, Wrangler and GitHub, plus OAuth/CSRF owner approval with ≤6 genuine calls.
- Actual model entitlement and account-wide Free quota at launch time; if unverified, STOP without first inference.
- The Free-only planning helpers return `authorizesInference:false` and `guaranteesNoCharge:false` even if all mock inputs fit. They are never imported by production and cannot justify deployment or charging the account.

**Status: code-only progress / actual Free balance UNKNOWN / zero paid changes / 0 of 6 live smoke calls / production SAFE OFF.**
