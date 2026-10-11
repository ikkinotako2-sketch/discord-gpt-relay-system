# Discord AI Relay Lab — verified production status (2026-10-12)

## CURRENT: BOUNDED_LOOP_LIVE / CRON_ENABLED / FIRST_END_TO_END_DISCORD_TEST_PASS

### First real Discord-to-Cron-to-D1 loop: PASS (user screenshots 2026-10-12)
- Discord `/loop-status` initially showed no run history.
- `/loop` returned `受付完了` with run ID `d1558987462942916668`.
- At 08:42 local screenshot, `/loop-status` showed **queued, calls_used 3/4**.
- At 08:43 local screenshot, `/loop-status` showed **completed, calls_used 4/4, final artifact present**. This provides end-to-end evidence of successfully persisting and advancing all four claimed AI operations via the scheduled Worker, and reaching completion without manual retries.
- The final artifact's visible topic concerns safe action when in a hurry, whereas the *suggested example prompt* was to improve a short greeting. The actual submitted `/loop task` field is not visible in screenshots, so **prompt-following mismatch is only a possibility, not proven**. Confirm actual input before diagnosing.
- `/loop-stop` has not been live-tested; quota/latency/performance under load not verified.
- No official GPT model used: Cloudflare Workers AI Llama, bounded 2-round A/B cycle only.


### Verified GitHub Actions evidence
- **Production release SUCCESS:** [38181913277](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38181913277). Offline tests **55/55 PASS**. The existing Worker `steep-glitter-b5cddiscord-ai-relay-lab` promoted exact pre-uploaded version **`aecc9c29-dbef-4abb-8036-3fd3bfbacc23`** to **100%**.
- Production response after propagation: GET returned HTTP 200 with exact `Discord GPT Relay loop-v1 ready.` identity, verifying D1 table query, AI binding and operator ID format. A POST without Discord signature returned 401. Automatic rollback was **not** necessary.
- **Discord command registration SUCCESS:** [38181972890](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38181972890). Discord API returned HTTP 201 for **`/loop`**, **`/loop-status`**, and **`/loop-stop`**. Existing `/ask` and `/relay` commands were not replaced.
- **Cloudflare Cron activation SUCCESS:** [38182038658](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38182038658). Worker version checked again; Wrangler returned `Deployed ... triggers` with `schedule: */1 * * * *` (once a minute). This trigger deploy changed the Cron schedule, not Worker source code.
- The old baseline version `b1b421c3-23fe-4a55-b8a7-db72b36848cc` had been verified **read-only** before promotion, after the operator secret was added.
- The three single-use production command/trigger workflows were removed after verified success. Completed GitHub Actions logs remain available.

### Production architecture and limitations
- Starts only when the allowlisted Discord owner submits `/loop task: ...`. Status and stop are owner-only.
- One active job globally; a maximum of two `planner -> builder` rounds or **four claimed Llama AI calls**. A result of the first builder becomes reference context for the second planner.
- Cloudflare Cron runs once per minute; at most one model call per scheduled invocation. It periodically checks D1 even when no work is queued, but **no AI inference call is made when idle**.
- Dedicated D1 database `discord-relay-loop-state`, UUID `d80b08a4-0ff7-4320-9575-0d3c55cf7aba`, **not** the Project Love Machine D1. User screenshot verified the `relay_loop_jobs` table exists with zero rows before this new production deployment.
- Includes stop-request semantics, atomic job claim, per-run call bounds, 24-hour retention, no blind retries on unknown jobs, and metadata-only diagnostic logs.
- **IMPORTANT:** The first live Discord-to-Cron-to-D1 four-step test is user-verified PASS, but repeatability, prompt adherence and STOP remain unverified.
- Uses **Cloudflare Workers AI Llama**, **not ChatGPT web sessions or OpenAI GPT API**. It is a bounded, explicitly started AI-agent loop, **not an infinite self-running GPT network**. Cloudflare free-plan quotas remain applicable.

### Immediate user verification needed
1. In the AI Relay Lab Test Discord server, run `/ask question: こんにちは` and `/relay task: 簡単な挨拶文を考えて` after release; report regressions.
2. Run **`/loop-status`** first (it should return no history, or show only a known earlier run). If Discord global slash commands take time to appear, wait for registration propagation.
3. Start exactly **one safe short experiment**: `/loop task: 2周で短い挨拶文を改善して`.
4. Check `/loop-status` every minute for up to four cron cycles plus propagation time. Desired completion status `完了`, calls used `4/4`, and visible `最終案`. **Do not retry automatically** if result is `failed`, `stopped`, or `unknown`.
5. Test `/loop-stop` on a **separate deliberately queued** test only if desired, and ensure it does not process further calls. Do not run it during the first completion experiment.

### Safety / rollback
- Emergency manual workflow `.github/workflows/rollback-relay.yml` is pinned to the last secret-bearing, pre-loop verified Worker version `b1b421c3-23fe-4a55-b8a7-db72b36848cc`. Production rollback is a user-authorized write; use only if a real regression occurs. The Cron trigger may need separate disabling upon rollback, because version rollbacks and trigger changes are separate operations.
- The temporary `SETUP_KEY` was absent from the last Cloudflare secret-name check. Legacy unused Worker `DISCORD_BOT_TOKEN` remained, and can be removed **after** stable live command/loop verification, followed by revalidation; preserve `DISCORD_PUBLIC_KEY`, `AI` and `DISCORD_ALLOWED_USER_ID`.
- Never share secrets or Discord Bot Tokens. Don't modify any Project Love Machine resources.
