# GPT-OSS 20B Discord Loop — production pilot

## Current state — 2026-10-12

**GPT-OSS deployed and HTTP verified; real model inference not yet tested.**

- User confirmed Cloudflare Free plan. No purchase or plan upgrade was made.
- Latest owner-only Discord status screenshot showed Llama run d1559005008987430922 terminal, completed with 4/4 calls. A global D1 active-job query from GitHub did not succeed, so only the latest run has been verified terminal.
- Preview and inactive upload: GitHub Actions 38189809571, 72/72 offline tests PASS; candidate version 64b48d3f-a427-4229-af27-c8c3710fa309.
- Verified preview HTTP 200, signature-less POST 401: GitHub Actions 38189921268.
- Approved production promotion: GitHub Actions 38193022088, SUCCESS, 72/72 tests PASS. The candidate was promoted to 100% production.
- After propagation, GET returned HTTP 200 and 'Discord GPT Relay gpt-oss pilot ready.'. Unsigned Discord POST returned HTTP 401. Live deployment list matched the candidate version.
- The /loop handler now uses Cloudflare-hosted OpenAI open-weight gpt-oss-20b; existing /ask and /relay still use their original Llama implementations.
- Existing dedicated Discord-only D1, once-a-minute Cron trigger, one-active-job limit, owner allowlist, at most 2 rounds / 4 model calls, STOP and no-blind-retry rules remain.
- The consumed one-shot release trigger and workflow were removed after success. Previous working Llama quality-v2 version 91dd0014-179c-44b8-88ac-7084776f5e7b is the pinned manual rollback target.

## Critical outstanding checks

- GPT-OSS has NOT yet returned a verified real response. Offline mocks and GET health only validate routing and code, not real inference.
- Test existing /ask and /relay after the model swap, test /loop-stop separately, and monitor free-tier quota.
- The most recent screenshot proves the latest prior job completed, but not a global D1 active-job count.
- This is Cloudflare Workers AI gpt-oss, not the consumer ChatGPT interface or automated ChatGPT-chat handoff.

## One controlled verification test

Use /loop-status first and confirm no queued or running job.
Submit one short Discord job: /loop task: こんにちはを使った短い挨拶文を作って
Then use /loop-status about once a minute, looking for completed, 4/4, and a relevant final answer.
If it reports failure/unknown or quota exceeded, DO NOT automatically retry; gather the status for diagnosis.
All model calls are subject to Cloudflare Free daily quota. No paid usage is authorized.

## Evidence

- https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38193022088
- https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
