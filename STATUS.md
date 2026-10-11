# AI Relay Lab — verified status (2026-10-11)

## Stage 2 development — 2026-10-11 (GitHub only; NOT live)

- Automatic finite cycle code `loop-core.mjs`: **planner A → builder B → planner A (prior builder output) → builder B**, maximum two rounds / four model calls.
- `loop-worker.mjs`: provider-neutral invocation through existing **Cloudflare Workers AI Llama** binding; there is no consumer ChatGPT cross-chat connection.
- `loop-state.mjs`: revision-controlled single-step state transitions to support future resumable processing and cooperative STOP. A future DB adapter must implement **atomic lease / compare-and-swap** before this can prevent duplicates across workers.
- New isolated D1 schema **only staged** at `db/migrations/0001_discord_loop_jobs.sql`; not applied or provisioned. Do **not** use any PLM database.
- CI run `38143409618`: **33/33 PASS**, zero failed. New D1 migration itself is not included in those 33 logic tests.
- **Current live Worker remains `f50669d7-7685-4da1-b2e5-567ae7526922`**. No `/loop` Discord command is registered, no background loop runs, and no extra Cloudflare AI calls were triggered by this development.
- Next blocker for a *live* reliable autonomous loop: create a **new dedicated Discord-only D1 database**, deploy the schema with verification, implement atomic job runner with scheduled/queued steps and limited quotas, then add authenticated `/loop`, `/loop-status`, and `/loop-stop` endpoints.
- Actual GPT model access would require a separate **authorized API** and may have additional costs. A ChatGPT subscription does not create a free programmable GPT connection. Keep the zero-extra-spend constraint and do not connect billed services without approval.

---


## CURRENT: LATENCY_V1_PRODUCTION_LIVE / DISCORD_COMMANDS_REGISTERED / NEW_VERSION_DISCORD_TEST_PENDING

### Completed and verified

- User-confirmed success of both `/ask` and `/relay` on the **earlier** Worker release.
- Guarded latency rollout run **38141199583** completed **SUCCESS**.
- Offline regression tests **14/14 PASS**.
- Cloudflare Worker `steep-glitter-b5cddiscord-ai-relay-lab` promoted to version **`f50669d7-7685-4da1-b2e5-567ae7526922`** at **100%**.
- The live GET endpoint returned HTTP 200 with unique body `Discord GPT Relay ready (latency-v1).` at verification attempt 2 (the first attempt still served the previous response).
- A POST without a valid Discord signature returned HTTP **401** in that verification. Automatic rollback was **not** needed.
- The one-shot upload and rollout workflow files were removed after successful use so they cannot be retriggered by subsequent pushes. GitHub Actions execution records remain accessible.
- This only changes Cloudflare Worker code: Discord `/ask` and `/relay` commands were registered before the speed rollout; no re-registration was needed.

### Latency changes now deployed

- Max output tokens: planner **260**, builder **320**, ask **240**, versus previous planner/builder **450** and ask **350**.
- Log `workers_ai_timing` metrics per AI phase with **role and duration only**, without prompts, results, user ID, or tokens.
- `/relay` response now includes approximate total model processing elapsed time, marked `AI処理：約...秒`.
- Shorter outputs may improve elapsed time, but a **measured speedup is not confirmed**.

### User verification still required

1. On AI Relay Lab Test, run `/ask question: こんにちは` and confirm the reply arrives.
2. Run `/relay task: 簡単なWebサイトの作成計画を考えて`; confirm `【AI A：計画】`, `【AI B：実装案】`, and `AI処理：約...秒`. Compare perceived response time.
3. If either command fails, collect non-secret error information; do **not** repeatedly trigger deployment.

### Security cleanup pending

- The old `SETUP_KEY` was previously visible in a screenshot. **Delete or rotate it in Cloudflare**; currently deployed source does not expose temporary `/__register_ask` endpoint.
- The old Cloudflare Worker `DISCORD_BOT_TOKEN` is not needed by the active Worker source after registration. If removed, verify `/ask` and `/relay` again because environment changes can affect live versions.
- **Do not delete `DISCORD_PUBLIC_KEY` or the `AI` binding.** Store API/Bot tokens in GitHub Secrets only; this repo is public.
- Project Love Machine resources remain separate.

### Emergency rollback

- Last **user-tested working** Worker version: `82537b42-90d1-424d-92d4-9dcc5b1309de`.
- Manual emergency rollback workflow `.github/workflows/rollback-relay.yml` is pinned to that version. Run only for a verified regression or incident.
- GitHub action `38141199583` confirms new live code from health check. It does not prove both Discord slash commands work until the user tests.

### Project goal and honest boundary

The current `/relay` performs **two sequential Cloudflare Workers AI calls to a Llama model**, with planner context passed to builder. It is **not** separate consumer ChatGPT chats, nor an unattended persistent multi-agent network. GPT-agent handoff, durable jobs, retry/stop rules and monitoring remain future tasks. Cloudflare free-plan quotas and latency are not guaranteed.
