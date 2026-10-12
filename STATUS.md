# Discord AI Relay Lab — verified status (2026-10-12)

## CURRENT: QUALITY_V2_PRODUCTION_LIVE / HEALTH_PASS / NEXT_LIVE_DISCORD_TEST_PENDING

### Quality-v2 release — GitHub-verified
- **Authorized, inactive candidate upload SUCCESS:** [38188220975](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38188220975), **63/63 offline tests PASS**, dry-run build PASS. Cloudflare uploaded inactive version **`91dd0014-179c-44b8-88ac-7084776f5e7b`**; no production traffic changed at this step.
- **Authorized production release SUCCESS:** [38188333635](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38188333635), **63/63 PASS**. Before promotion: exact previously user-tested loop-v1 `aecc9c29-dbef-4abb-8036-3fd3bfbacc23` at 100%, GET health good, unsigned POST HTTP 401, and the five global Discord commands `/ask`, `/relay`, `/loop`, `/loop-status`, `/loop-stop` all listed under the expected AI Relay Lab app.
- The exact pre-uploaded version **`91dd0014-179c-44b8-88ac-7084776f5e7b`** was promoted to **100% production traffic**.
- Post-deploy check: first attempt still returned old GET marker; second attempt returned **HTTP 200** with exact `Discord GPT Relay loop-v2 task-focus ready.`, unsigned POST **HTTP 401**, and deployments list confirmed exact new version at 100%. **No automatic rollback needed**.
- Neither the Discord command definitions nor the previously configured one-minute Cloudflare Cron trigger were re-registered or changed by this release. **Cron's execution after this code change has not yet been confirmed by a new live run.**
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

### One final user-visible end-to-end test remains
1. In **AI Relay Lab Test**, verify `/ask question: こんにちは` and `/relay task: 簡単な挨拶文を考えて` still work.
2. Verify `/loop-status` responds with `元の依頼`, current status and previous final result. The old result will not be reclassified retroactively.
3. Start **one new test job** only: `/loop task: こんにちはを使った短い挨拶文を作って`. Wait for up to four Cron cycles, checking `/loop-status` every minute.
4. Expected result: `完了`, 4/4, final answer with a greeting. If output fails the greeting heuristic it should instead say `失敗` and `品質検査`, with no automatic retry. If `unknown`, `failed`, or stale, do not resubmit blindly; investigate Cloudflare/D1 logs first.
5. The original `/loop-stop` is still not verified in a live end-to-end test. Test separately, not during the first quality-v2 success run.

### Important accuracy boundary
- This is a **user-initiated, bounded Llama Workers AI A→B→A→B loop** in Cloudflare, not ChatGPT consumer chats or OpenAI GPT API.
- GitHub CI, deployment identity, HTTP security and D1 connectivity do not constitute proof that the *new version* now follows the user's specific task correctly. A real Discord run is necessary.
- Free tier limits and Cloudflare Worker timeouts still apply. There is no perpetual unbounded execution.
