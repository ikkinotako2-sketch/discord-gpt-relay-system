# AI Relay Lab — verified status (2026-10-11)

### D1 migration verified — 2026-10-11
- User screenshot confirms `SELECT COUNT(*) AS total FROM relay_loop_jobs;` returned **total = 0** in the new Discord-only D1 Console.
- This verifies that `relay_loop_jobs` exists and starts empty. The creation SQL for its three indexes previously returned success as well.
- Dedicated D1 ID is configured in `wrangler.loop.toml`; it remains **NOT bound to live production**.
- **Only account setup blocker before staged inactive upload:** add secret `DISCORD_ALLOWED_USER_ID` to the Discord Worker, with the user's own numeric Discord User ID. Keep the existing `DISCORD_PUBLIC_KEY` and Workers AI `AI`.
- Cloudflare Worker variable/secret changes may create a new production version. After creating the secret, reverify current production `/ask`, `/relay`, and baseline deployment ID before promoting new code; do not blindly rerun pinned release if baseline differs.
- No loop command or cron has been activated, and Project Love Machine remains isolated.

### D1 provisioning update — user screenshot verified (2026-10-11)
- Dedicated Discord-only D1 named `discord-relay-loop-state` was created on Cloudflare.
- Database UUID shown by dashboard and now pinned in `wrangler.loop.toml`: `d80b08a4-0ff7-4320-9575-0d3c55cf7aba`.
- Screenshot still shows **0 tables**. Schema migration has **NOT** been applied or verified.
- **Do not deploy** the loop Worker or run loop-upload/release yet. Await D1 console schema apply and operator `DISCORD_ALLOWED_USER_ID` secret configuration.
- Project Love Machine database remains untouched.

### D1 migration update — Cloudflare Console screenshot (2026-10-11)
- Screenshot of the dedicated `discord-relay-loop-state` console shows the SQL creating `relay_loop_jobs` and three indexes was run, with Cloudflare saying "このクエリーは正常に実行されました".
- The query `SELECT COUNT(*) AS total FROM relay_loop_jobs;` has **not yet been shown** as verified, and current row count remains unconfirmed.
- `wrangler.loop.toml` is pinned to that Discord-only D1 UUID. Keep `loop-upload.yml`, `loop-release.yml`, command registration and Cron deployment **unexecuted** until the table count is checked and the `DISCORD_ALLOWED_USER_ID` Worker secret is configured.
- Existing /ask and /relay production Worker remains unchanged by the SQL migration.

## Stage 3 — all GPT-accessible development completed (2026-10-11)

**STATUS: GITHUB_IMPLEMENTED / 55_TESTS_PASS / D1_AND_OPERATOR_CONFIG_BLOCKED / LIVE_NOT_UPDATED.**

- Dedicated D1 adapter `loop-d1.mjs` with single active job, atomic step claims, stop, expiry, no automatic retry and 24-hour cleanup.
- Staged Worker `worker-loop.mjs` supporting owner-only `/loop`, `/loop-status`, `/loop-stop`, one AI operation per scheduled tick, preserving `/ask` and `/relay`.
- Staged isolated database schema `db/migrations/0001_discord_loop_jobs.sql` (NOT applied anywhere).
- Staged `wrangler.loop.toml` with a **placeholder new D1 UUID**; it is intentionally invalid until the user creates `discord-relay-loop-state`.
- Staged manual, guarded GitHub workflows `loop-upload.yml`, `loop-release.yml`, `register-loop-commands.yml`, `loop-enable-cron.yml`. All gated, none executed.
- **GitHub CI run 38145019044: 55/55 PASS** (SQLite persistence + Discord signed interaction tests).
- **Not deployed**: Production remains latency-v1 `f50669d7-7685-4da1-b2e5-567ae7526922`, with `/ask` and single-pass `/relay`.
- **Blockers requiring account owner**: create new Discord-only D1; apply migration in that NEW DB; set Cloudflare `DISCORD_ALLOWED_USER_ID` in the existing Worker. Do not touch PLM.
- Exact minimal user steps and safe release path: `docs/LOOP_LAUNCH_CHECKLIST.md`.
- No API billed GPT model, unlimited loop, or consumer ChatGPT cross-chat automation has been created.

---


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
