# Discord Relay Lab — Launch checklist for bounded background AI loop

## Proven code status

The following are complete, committed to GitHub and tested (55 PASS, run `38145019044`):

- `/loop`: owner-only, task 1–1000 chars, **ONE active task globally**, default two rounds, max four claimed AI calls.
- `/loop-status`: owner-only, shows progress and final output if completed.
- `/loop-stop`: owner-only. Stops queued work immediately; in-flight model calls cannot be canceled retroactively but their result is discarded, no new calls start.
- One Cloudflare Workers AI (Llama) call per scheduled tick; automatic A→B→A→B handoff with persisted reference context.
- Atomic SQLite/D1 `UPDATE ... RETURNING` claims, revision checks, 5-minute leases; unknown status never auto-retries.
- 24-hour data retention after insertion, cleanup on cron ticks; privacy-safe log metadata only.
- Existing `/ask` and `/relay` handlers are preserved by delegation.
- Worker GET health returns `Discord GPT Relay loop-v1 ready.` only when owner allowlist, Workers AI binding, D1 binding AND migration can be queried. Signature-less POST remains HTTP 401.
- Strict Cloudflare account/Worker name checks, staged inactive upload, manual guarded promotion with rollback, separate command registration, separately authorized Cron trigger.
- Public repository has **no tokens, Discord message history, DB IDs, or Discord owner IDs** committed in it.

## BLOCKED: three Cloudflare setup items requiring the account owner

1. Create a **new, free-tier D1 database** named exactly `discord-relay-loop-state` within Cloudflare account `6c8ccd6aface937ab5dabef61cb64534`. Do not use `plm-serverless-sandbox-state` or any Project Love Machine database. Copy the UUID of this NEW DB (an identifier, **not** an API token).
2. In that new D1 database's **Console**, apply the SQL from `db/migrations/0001_discord_loop_jobs.sql`. Use its exact table name `relay_loop_jobs`. Do not run the SQL in another database. Confirm with `SELECT COUNT(*) AS total FROM relay_loop_jobs;`. Starting row count should be zero.
3. In the **existing Discord Relay Worker only**, set a Cloudflare *secret* `DISCORD_ALLOWED_USER_ID` to the authorized Discord owner's numeric User ID (enable Discord Developer Mode; copy User ID). Keep `DISCORD_PUBLIC_KEY` and AI binding untouched. Do not post secrets, Bot Tokens or API Tokens in chats or screenshots. Remove/rotate the previously exposed `SETUP_KEY` once safe.

User can tell ChatGPT **only the new D1 UUID** (not a token), and that schema + owner secret are installed. ChatGPT can then update the staged `wrangler.loop.toml` and prepare the remaining release.

## Future release sequence — DO NOT RUN until three items above are complete

1. Configure `wrangler.loop.toml` `database_id` with the newly created Discord-only D1 UUID. Existing production `wrangler.toml` stays unchanged. Verify DB name and account in Cloudflare.
2. Run the GitHub Actions workflow **Loop Candidate Upload (Manual, No Live Change)**. Tests/compile must pass, and output contains `Worker Version ID: <UUID>`. This does not change live traffic or scheduled triggers.
3. Run **Loop Release (Manual, Guarded Rollback)** with exactly that version UUID and explicit confirmation `DEPLOY-LOOP`. It checks last known production version and restores it automatically if new live health fails.
4. Immediately re-test the existing Discord `/ask` and `/relay` to ensure backward compatibility.
5. Run **Register Loop Commands (Verified Live Only)**. It requires the new unique health marker and valid Bot Token for the correct app. This registers only `/loop`, `/loop-status`, `/loop-stop` and does not replace `/ask` or `/relay`.
6. Run **Enable Discord Loop Cron (Manual, Guarded)** with confirmation `ENABLE-ONE-MINUTE-CRON`. Trigger runs every minute (free-tier limits apply) and does **not** make AI calls when no owner-submitted job is queued.
7. Start **one** harmless test: `/loop task: 2回の改善で短い挨拶文を作って`; poll `/loop-status` until completed; if needed, test `/loop-stop`. Expected up to 4 AI calls with 1–2 minutes between steps. Do not repeatedly submit requests.
8. Confirm cleanup of prior `SETUP_KEY` and obsolete Cloudflare Worker `DISCORD_BOT_TOKEN`; keep GitHub `DISCORD_BOT_TOKEN` only if needed to register commands later.

## What this is NOT

- It does **not** automate ChatGPT consumer sessions, and the Llama model is **not** GPT.
- It is NOT unlimited self-running, automatically self-improving without a user job, able to perform arbitrary external actions, or guaranteed $0 in every future Cloudflare pricing scenario.
- No D1 has been created or modified by the GitHub-only development work. **Current live Worker stays `f50669d7-7685-4da1-b2e5-567ae7526922`.**
- The old `/ask` and `/relay` are expected to remain live until an expressly validated release.
