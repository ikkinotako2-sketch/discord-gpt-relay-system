# Discord AI Relay Lab — verified status (2026-10-12)

## GPT-OSS pilot LIVE — 2026-10-12, real inference still unverified

- User confirmed Cloudflare **Free** and supplied Discord `/loop-status` screenshot for latest run `d1559005008987430922`: `完了`, `4/4` AI calls, short greeting output. This supports the latest run being terminal. It does **not** independently prove all D1 rows are inactive; the prior remote D1 aggregate read [38191806194](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38191806194) failed before producing a count. No paid billing or quota upgrade occurred.
- **Production GPT-OSS release: SUCCESS** [38193022088](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38193022088). All **72/72 offline tests PASS**. Preflight verified Llama quality-v2 version `91dd0014-179c-44b8-88ac-7084776f5e7b` at 100%, live health and 401 signature gate, candidate version existence and health.
- **GPT-OSS version `64b48d3f-a427-4229-af27-c8c3710fa309` deployed to 100% production.** Live GET returns exact `Discord GPT Relay gpt-oss pilot ready.` with HTTP 200, unsigned POST HTTP 401; Cloudflare deployment list confirmed candidate at 100%. Automatic rollback **not needed**.
- `/loop` now opts into Cloudflare Workers AI **`@cf/openai/gpt-oss-20b`** through a static binding variable, with at most two A→B rounds/four claimed inference calls. `/ask` and `/relay` should continue using Llama through their original implementation, but **their post-release live responses have not yet been user-tested**. Existing Cron, Discord registration and isolated D1 have not been modified by the version promotion.
- **Actual GPT-OSS inference is NOT YET verified.** Deploy readiness only tests bindings/DB query and signature checking; next step is **one** short user-initiated Discord `/loop` job after checking `/loop-status`, then wait for `4/4` or collect failure/error without retrying blindly. Stop further attempts if quota or permission errors arise. Do not claim full GPT loop completion until this live test succeeds.
- Emergency/manual rollback workflow now targets immediately preceding, user-tested **Llama quality-v2 `91dd0014-179c-44b8-88ac-7084776f5e7b`** (not older v1). Any rollback must be explicitly authorized; current rollout required none.
- `gpt-oss-20b` is OpenAI's **open-weight model hosted by Cloudflare**, not consumer ChatGPT browser conversations and not the separately billed OpenAI API.
- Free Workers AI allocation is limited; user explicitly rejects paid subscriptions, credits or upgrades.

---

## Free-plan confirmation and active-job preflight (2026-10-12)

- User confirmed **Cloudflare Free plan**. No billing upgrade or paid API has been requested or performed.
- Read-only GitHub Actions run [38191806194](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38191806194) attempted a scoped Cloudflare remote D1 aggregate query (`COUNT(*)` of queued/claimed active jobs) and **FAILED** before reporting a count. Logs contain only generic exit code 1; cause not established. Do not falsely assume empty active queue or permissions.
- **BLOCKED** until owner-only Discord `/loop-status` shows a terminal status (completed/stopped/failed) and release-time authorization is reconfirmed; safer release workflows should also include a D1 active-job verification guard when permission becomes available.
- GPT-OSS inactive version remains `64b48d3f-a427-4229-af27-c8c3710fa309`; production remains user-tested Llama `91dd0014-179c-44b8-88ac-7084776f5e7b` as far as last verified. No deployment or inference attempted in this preflight.

---

## GPT-OSS pilot — INACTIVE CANDIDATE READY, LIVE LLAMA PRESERVED

- Current production: user-tested **Llama** quality-v2 version `91dd0014-179c-44b8-88ac-7084776f5e7b`. The actual `/loop` continues to use Llama. No official GPT API subscription or consumer ChatGPT chat is connected.
- Model feature: strict opt-in via `LOOP_AI_MODEL = "@cf/openai/gpt-oss-20b"`, selected **only** by the staged `wrangler.gpt-oss.toml`. Missing value still defaults to Llama. Unexpected values fail before an AI call or D1 step claim.
- Integration tests: **72/72 PASS** and Wrangler dry-run PASS at [38189809571](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38189809571).
- Cloudflare inactive GPT-OSS version **`64b48d3f-a427-4229-af27-c8c3710fa309`** successfully uploaded; GET preview health and unsigned signature rejection **PASS** at [38189921268](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38189921268).
- Post-upload check reconfirmed original Llama production live at 100%; no change to current Discord commands, D1 schema or Cron.
- **No actual GPT-OSS inference was run**. It remains unknown whether the model will produce a usable Japanese response within budget/time limits.
- A future release workflow is **staged but not run**, `.github/workflows/gpt-oss-pilot-release.yml`, pinned to exact candidate and user-tested Llama rollback version.
- **BLOCKERS before production:** account owner's confirmation of **Cloudflare Free** (no unapproved billing), no queued/claimed Discord jobs, express approval of limited GPT-OSS inference on the free allocation. Changing billing plan, purchasing credits and mass model testing are out of scope.
- Full plan: `docs/GPT_OSS_PILOT.md`.

---

## CURRENT: QUALITY_V2_PRODUCTION_LIVE / FIRST_LIVE_QUALITY_TEST_PASS / STOP_TEST_PENDING

### Live quality-v2 test PASS — user screenshot 2026-10-12
- Discord run ID: `d1559002753630605473` (started around 09:40 Japan time according to screenshot).
- Original task confirmed by owner-only `/loop-status`: `こんにちはを使った短い挨拶文を作って`.
- The same run reached **state `完了`, calls used `4/4`, max two rounds** at around 09:44 Japan time in the user's screenshot, after an earlier partial `2/4` status was visible.
- Final persisted artifact shown: `はじめまして、こんにちは！`, a directly relevant short Japanese greeting.
- **End-to-end Discord submission → D1 state → scheduled Llama A→B→A→B → persisted owner-visible response VERIFIED** on the updated quality-v2 Worker. No automatic retries reported.
- This proves one correctly completed **greeting** task; it does **not** establish that all future topics will be accurate or that the narrow heuristic never misclassifies outputs.
- Remaining tests: `/loop-stop` in a separate active experiment; `/ask` and `/relay` after quality-v2 production; sustained performance, quota, and alerting remain unverified.



### Quality-v2 release — GitHub-verified
- **Authorized, inactive candidate upload SUCCESS:** [38188220975](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38188220975), **63/63 offline tests PASS**, dry-run build PASS. Cloudflare uploaded inactive version **`91dd0014-179c-44b8-88ac-7084776f5e7b`**; no production traffic changed at this step.
- **Authorized production release SUCCESS:** [38188333635](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38188333635), **63/63 PASS**. Before promotion: exact previously user-tested loop-v1 `aecc9c29-dbef-4abb-8036-3fd3bfbacc23` at 100%, GET health good, unsigned POST HTTP 401, and the five global Discord commands `/ask`, `/relay`, `/loop`, `/loop-status`, `/loop-stop` all listed under the expected AI Relay Lab app.
- The exact pre-uploaded version **`91dd0014-179c-44b8-88ac-7084776f5e7b`** was promoted to **100% production traffic**.
- Post-deploy check: first attempt still returned old GET marker; second attempt returned **HTTP 200** with exact `Discord GPT Relay loop-v2 task-focus ready.`, unsigned POST **HTTP 401**, and deployments list confirmed exact new version at 100%. **No automatic rollback needed**.
- Neither the Discord command definitions nor the previously configured one-minute Cloudflare Cron trigger were re-registered or changed by this release. **Cron execution has now been confirmed by the new live 4/4 run (see above).**
- The consumed upload/promotion GitHub workflow and marker files were removed to prevent accidental replay. Historical Actions run records remain.

### Reason for the improvement
- On the first real Discord loop (run `d1558987462942916668`), user explicitly entered **`短い挨拶文を改善して`**. Discord showed **4/4 calls and completed** in the D1/Cron loop, but the actual final artifact was about safe behavior when in a hurry. Infrastructure completed correctly; **answer quality failed**.
- `loop-quality.mjs` now makes each planning/building AI stage prioritize the original user task and treat prior AI outputs as untrusted reference text.
- For **explicit greeting tasks only**, a conservative keyword checker flags obviously unrelated final replies, and `loop-d1.mjs` records `TASK_MISMATCH` with `failed` status instead of incorrectly marking `completed`. **No new model calls, automatic retries or hidden background tasks are introduced**.
- Authorized owner-only `/loop-status` can now display **`元の依頼`**, the result and a quality-failure explanation. Only the authorized Discord owner may see this status.
- This is a **heuristic limited to greetings**, not semantic verification of arbitrary tasks; it cannot guarantee all outputs are relevant.

### Preserved infrastructure
- Cloudflare Worker: `steep-glitter-b5cddiscord-ai-relay-lab`.
- Isolated Discord-only D1 `discord-relay-loop-state` (UUID `d80b08a4-0ff7-4320-9575-0d3c55cf7aba`); Project Love Machine D1 remains untouched.
- Cron trigger previously enabled at `*/1 * * * *` (every minute), at most one claimed Llama AI inference per queued step.
- Five registered Discord commands: `/ask`, `/relay`, `/loop`, `/loop-status`, `/loop-stop`.
- One active job globally; up to 2 planner/builder rounds (4 claimed AI calls) per explicit `/loop` invocation. D1 revision/lease checks, cooperative stop, no blind retries, approximately 24-hour data retention.
- Last live-tested four-call version: **`aecc9c29-dbef-4abb-8036-3fd3bfbacc23`**. Emergency manual rollback workflow `.github/workflows/rollback-relay.yml` is pinned to that version and is **not executed**.
- Old exposed `SETUP_KEY` was absent on the last secret-name inspection. Old Worker `DISCORD_BOT_TOKEN` may still be present, but current Worker code does not need it. Keep `DISCORD_PUBLIC_KEY`, `DISCORD_ALLOWED_USER_ID` and AI binding.

### Next user-visible tests after first quality-v2 PASS
1. In **AI Relay Lab Test**, verify `/ask question: こんにちは` and `/relay task: 簡単な挨拶文を考えて` still work.
2. Verify `/loop-status` responds with `元の依頼`, current status and previous final result. The old result will not be reclassified retroactively.
3. **PASS:** The requested greeting experiment completed 4/4 with a relevant final answer; do not rerun that experiment.
4. In a **separate** test run, check `/loop-stop` after a new short test job, confirm no further inference, and do not retry failure/unknown automatically.

### Important accuracy boundary
- This is a **user-initiated, bounded Llama Workers AI A→B→A→B loop** in Cloudflare, not ChatGPT consumer chats or OpenAI GPT API.
- A real Discord run has now shown the new version following **one greeting task** correctly, not a general proof of accuracy for arbitrary tasks.
- Free tier limits and Cloudflare Worker timeouts still apply. There is no perpetual unbounded execution.
