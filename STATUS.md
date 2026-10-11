# Current project status — 2026-10-11

## Fixed ultimate goal
**Discord-mediated automatic handoff between multiple GPT chat/agent contexts.** This is not satisfied merely by the /ask bot or by two calls to Cloudflare's Llama model.

## Independently verified
- GitHub Actions offline tests: **13/13 PASS** on run 38134687309 (2026-10-11).
- Cloudflare inactive version upload: **SUCCESS** on run 38134687309.
- Worker: `steep-glitter-b5cddiscord-ai-relay-lab`.
- Uploaded inactive version: `82537b42-90d1-424d-92d4-9dcc5b1309de`.
- The version upload did NOT switch production traffic.
- Existing /ask replied in Japanese according to the user, before the upload; not independently retested afterwards.
- One-step guarded release workflow prepared: `.github/workflows/release-verified-relay.yml`.

## Pending before live release
1. Add `DISCORD_BOT_TOKEN` to **GitHub Actions Secrets** for this repository; this is NOT the Cloudflare account token and must not be posted in chat or committed. Reset it if necessary. A standalone app command register requires this token.
2. Check/disable the exposed previous `SETUP_KEY` in Cloudflare. It appeared in a screenshot. Do not post the new value anywhere.
3. Explicitly run **Release Verified Discord Relay** with `approve=RELEASE`. This manually promotes only the pinned already-tested version. No automatic production deployment on push.
4. Verify the GitHub release run succeeded; ask and relay commands still work in Discord.
5. Remove leftover unneeded Cloudflare `SETUP_KEY` and `DISCORD_BOT_TOKEN` after production change, preserve `DISCORD_PUBLIC_KEY` and `AI`. Removing an environment secret may itself publish a new Worker version; verify runtime afterward.
6. Keep a rollback reference to the prior deployment before release (the workflow prints previous deployment metadata).

## Isolation
- GitHub repo is public. Never publish user-private transcripts, bot tokens, or secret values.
- No Project Love Machine resources modified.
- Workers AI `@cf/meta/llama-3.1-8b-instruct-fp8` is used in the prototype, not GPT consumer chat sessions.
- No actual autonomous loop or GPT chat-to-chat relay is deployed yet.
- Workflow never charges intentionally; cloud free quotas may apply.

## Safety controls
- Exact account ID and Worker name are pinned in the release job.
- Exact previously uploaded version ID is pinned in release command.
- Release requires a manual `RELEASE` input.
- Offline tests and Bot Token validation must succeed *before* production switch.
- The /relay command is registered *after* health check, without replacing /ask.
- No `/__register_ask` handler in the new version.
