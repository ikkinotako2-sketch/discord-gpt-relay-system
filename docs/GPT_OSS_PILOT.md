# GPT-OSS-20B pilot — prepared, NOT publicly switched

## Verified on 2026-10-12

**STATUS: GPT_OSS_INACTIVE_UPLOADED / PREVIEW_HEALTH_PASS / LLAMA_PRODUCTION_UNCHANGED**

- Cloudflare model: **`@cf/openai/gpt-oss-20b`**. This is an **OpenAI open-weight model hosted by Cloudflare**; it is NOT the consumer ChatGPT chat or a paid OpenAI GPT API session.
- Existing production Worker stays at version **`91dd0014-179c-44b8-88ac-7084776f5e7b`** with Llama for current `/loop`.
- Exactly scoped Discord Worker `steep-glitter-b5cddiscord-ai-relay-lab`; separate Discord-only D1 `discord-relay-loop-state`. No Project Love Machine data is involved.
- New source: `loop-quality.mjs` supports **strict opt-in only** via a static Wrangler `LOOP_AI_MODEL` variable. Missing value defaults to the existing Llama. Unexpected model names fail closed **before** D1 claims a model call.
- GPT-OSS is requested with `reasoning_effort: low`, at most 300 output tokens for planner and 420 for builder; the D1 limit of 3000 characters remains. Use `response` or supported final text formats; do not expose reasoning output.
- Existing safeguards stay in force: owner-only commands, one active job globally, max 2 rounds, max 4 claimed calls, one step per minute, no automatic retries, D1 stop/unknown handling, only basic greeting-topic validation. `/ask` and `/relay` still use the original Llama pipeline.
- GitHub Actions [38189809571](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38189809571): **72/72 offline tests PASS**, Wrangler dry-run PASS, **inactive** version upload PASS.
- Inactive GPT-OSS Worker version: **`64b48d3f-a427-4229-af27-c8c3710fa309`**.
- Official version preview URL: `https://64b48d3f-steep-glitter-b5cddiscord-ai-relay-lab.ikkinotako2.workers.dev/`.
- GitHub Actions [38189921268](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38189921268): preview GET 200 with exact `Discord GPT Relay gpt-oss pilot ready.`; unsigned POST 401; original production GET 200 with `Discord GPT Relay loop-v2 task-focus ready.`, unsigned POST 401. **No actual GPT-OSS inference calls were made**.
- Cloudflare version upload by itself does NOT change production traffic or Cron.

## Before turning GPT-OSS on for real

1. **Account owner confirms Cloudflare Workers AI is on the Free plan**, and that no spending, billing plan upgrade or extra token purchases are authorized. Cloudflare documents that Workers Free has **10,000 free Neurons/day** and stops on exhaustion. Model usage is not infinite and other AI usage shares this allocation.
2. Owner checks `/loop-status` and confirms **no active job** (`completed` / `failed` / `stopped`, not `queued` or `claimed`). Switching AI models mid-job is not permitted.
3. A separately approved release may use the staged `.github/workflows/gpt-oss-pilot-release.yml`, gated by exact Worker, D1 ID, current live version, preview health, 72+ tests, version UUID and rollback to Llama quality-v2. **Do not run it just to test the setup.**
4. After code promotion, user first confirms `/ask`, `/relay`, and `/loop-status` still work; then performs exactly **one short** `/loop` experiment (max four GPT-OSS calls, consuming Cloudflare free neurons). Monitor `/loop-status`. Errors or 'unknown' are **not** automatically retried.
5. On any regression, restore previous user-tested Llama version `91dd0014-179c-44b8-88ac-7084776f5e7b`, not the older pre-loop version. Cron and command registration are separate; do not replace them blindly.

## What has NOT been verified

- **No actual GPT-OSS response has been seen yet.** Offline mocks and preview health do not prove inference works, nor Japanese quality or speed.
- There is no automatic chat-to-chat consumer ChatGPT handoff. These are Cloudflare-hosted model calls, not interactions with this ChatGPT conversation.
- There is no independent Discord connector for this conversation, and writing files via the GitHub connector does not establish a Discord bridge to this chat.
- Cloudflare Free account status/remaining quota has **not** been inspected via authenticated billing tools.

### References

- https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
