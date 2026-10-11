# Discord AI Relay Lab — deployment readiness (2026-10-11)

## VERIFIED: INACTIVE_LOOP_CANDIDATE_READY / PRODUCTION_UNCHANGED_BY_THIS_STEP

### Current live production
- Worker: `steep-glitter-b5cddiscord-ai-relay-lab`
- Live Cloudflare Worker version: `b1b421c3-23fe-4a55-b8a7-db72b36848cc`, independently established in **read-only** GitHub run [38147537153](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38147537153).
- GET HTTP 200 with `Discord GPT Relay ready (latency-v1).`; unsigned POST HTTP 401.
- Secret-name metadata: `DISCORD_PUBLIC_KEY` and `DISCORD_ALLOWED_USER_ID` present, `SETUP_KEY` absent, old unused Worker `DISCORD_BOT_TOKEN` still present. **No secret values were retrieved.** Cannot establish whether the owner ID secret has the correct value beyond its presence.
- Secret registration created a NEW live version with the same latency-v1 response, so old baseline `f50669d7-7685-4da1-b2e5-567ae7526922` is no longer current.
- User **has not yet confirmed** that `/ask` and `/relay` both work after the new secret was registered. Retest them before approval of any production change.

### Dedicated D1 database
- New, Discord-only database `discord-relay-loop-state`, UUID `d80b08a4-0ff7-4320-9575-0d3c55cf7aba`; never use the Project Love Machine database.
- User screenshots show `relay_loop_jobs` table/index creation succeeded; `SELECT COUNT(*) AS total FROM relay_loop_jobs;` returned `0`.
- `wrangler.loop.toml` points to that exact database, but the current live Worker is NOT using it yet.

### Inactive candidate uploaded and tested
- Read-only probe: [38147537153](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38147537153) **SUCCESS**.
- Inactive upload: [38147689151](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38147689151) **SUCCESS**, **55/55 tests PASS**.
- Exact uploaded candidate Worker version: **`aecc9c29-dbef-4abb-8036-3fd3bfbacc23`**.
- The upload DID NOT deploy live code and DID NOT enable Cron or register new slash commands.
- Single-use read-only probe and inactive upload workflows have been removed, preserving completed GitHub execution logs.

### Guarded rollout still pending explicit production approval
1. Verify legacy Discord `/ask` and `/relay` work **now**, after the new Worker secret was added.
2. With explicit authorization for production, run `.github/workflows/loop-release.yml`, entering `DEPLOY-LOOP`. The workflow is pinned to candidate `aecc9c29-dbef-4abb-8036-3fd3bfbacc23` and checks live baseline `b1b421c3-23fe-4a55-b8a7-db72b36848cc` first. Automatic rollback targets the same baseline if post-release health fails.
3. After production health succeeds, verify legacy `/ask` and `/relay`, and run `register-loop-commands.yml` to register `/loop`, `/loop-status`, `/loop-stop`.
4. Separately enable the one-minute Cron via `loop-enable-cron.yml` after confirming live `/loop-status` and user approval. No AI calls occur unless the operator explicitly queues a job.
5. Start a single safe user-authorized test task, monitor status through 4 maximum claimed model calls, and test STOP. Do not blindly retry failed/unknown jobs.
6. Review and remove the unused, legacy Cloudflare Worker `DISCORD_BOT_TOKEN` secret only after stable production validation; preserving `DISCORD_PUBLIC_KEY` and `AI` is mandatory. Removing secrets can create a new live version.

### Bounded implementation and privacy
- GitHub files `loop-core.mjs`, `loop-state.mjs`, `loop-d1.mjs`, `worker-loop.mjs`, `wrangler.loop.toml`, and SQL migrations are staged.
- One active job globally, operator allowlist, at most 2 rounds / 4 AI calls, one inference per Cron tick, revision/lease checks, 24-hour retention, explicit status and STOP, no blind retry.
- Uses Cloudflare Workers AI **Llama**, NOT a pair of real consumer ChatGPT sessions or official GPT API. ChatGPT subscription alone does not include free OpenAI API credits.
- Nothing here promises indefinite background running or usage above free quotas. Do not alter PLM resources.
