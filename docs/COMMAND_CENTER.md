# AI Relay Command Center — private website

## Fastest safe publication path (prepared, not executed)

A **single guarded release workflow** now exists at
`.github/workflows/command-center-guarded-release.yml`.
It is **manual only** and requires two exact inputs:

- `confirm`: `RELEASE-PRIVATE-DASHBOARD`
- `active_job_check`: `NO-ACTIVE-JOB` (only after Discord `/loop-status` shows the latest job has ended)

It checks the exact existing **Discord-only Worker and D1 UUID**, the expected live GPT-OSS Worker version, all five existing Discord commands, required Worker secret **names** (not values), complete regression tests, a Wrangler dry-run, then uploads an **inactive** candidate and probes its health. Only after those gates pass can it promote the candidate; it then checks that anonymous visitors cannot view history, Discord OAuth login redirects correctly, and unsigned Discord POST remains 401. If the promoted version fails verification, it attempts a guarded rollback to the previous GPT-OSS Worker version. **This workflow never deploys to the YouTube/PLM repository, Workers, databases, or Cron.**

The release workflow has NOT been executed. The user must first register the OAuth redirect and two Worker secrets and confirm there is no current loop.

**Latest checks:** [full regression CI 38195334162](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38195334162) reported **94/94 PASS** and [private dashboard dry-run CI 38195217680](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38195217680) reported **60/60 focused PASS** and `ISOLATION_GUARD_PASS`. Any newer code requires rerun.

The private screen now also shows each saved step's **AI A/B handoff text**, not just the graphical arrows. This is available only after a successful owner login. The page polls every 15 seconds while open.

### Isolation constraints

- Only repository: `ikkinotako2-sketch/discord-gpt-relay-system`.
- Only Cloudflare Worker: `steep-glitter-b5cddiscord-ai-relay-lab`.
- Only D1: `discord-relay-loop-state` (`d80b08a4-0ff7-4320-9575-0d3c55cf7aba`).
- No calls to the YouTube API, no writes to Project Love Machine and no Cron changes in the release workflow.
- Cloudflare account-level shared Free quotas cannot be *universally* guaranteed isolated; the dry-run/build and site publication itself perform **no new AI inference calls**, minimizing indirect impact.

---

## What exists today (2026-10-12)

**STATUS: CODE_READY / SECURITY_TESTS_PASS / OFFLINE_BUILD_PASS / NOT DEPLOYED**

A responsive Japanese Web UI, API, OAuth2 authentication, and D1 read layer are implemented in GitHub, separate from the existing running Discord Worker:

- `command-center/index.html` — UI showing AI A (planning) and AI B (building), their 1→2 round A→B→A→B relay, active step, history, last output, start/stop controls and limits. Until connected, the UI clearly identifies example data as **DEMO** and keeps real controls disabled.
- `command-center/page.mjs` — exact bundled HTML string served only after private owner authentication, avoiding a public static file with user history.
- `command-center/data.mjs` — retrieves recent owner-specific D1 jobs, projects round/agent handoffs, caps outputs and disallows anonymous or other-owner queries.
- `command-center/server.mjs` — **Discord OAuth2 authorization-code login**, exact owner-ID allowlist, signed Secure HttpOnly SameSite=Lax 60-minute session, OAuth state cookie, CSRF + same-origin checks, anti-clickjacking/CSP/cache safety headers, read-only snapshot endpoint and owner-only create/stop APIs.
- `worker-loop.mjs` — routes `/command-center/*` to the backend while preserving all signed Discord commands and Cron. **This newer file exists only in GitHub; not deployed.**
- `wrangler.command-center.toml` — dedicated candidate config for the exact existing Discord Worker, GPT-OSS, AI binding, Discord-only D1 and 1-minute Cron. Enables dashboard only in this explicit candidate and **requires two NEW secrets**.
- `.github/workflows/command-center-build.yml` — local security regression tests and **Wrangler dry-run only**. No production or D1 writes.
- Actions [38194340121](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38194340121) **59/59 focused tests PASS + offline Worker build PASS**.
- Actions [38194340150](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38194340150) **92/92 all tests PASS**.

**Current production remains the previously deployed GPT-OSS candidate version `64b48d3f-a427-4229-af27-c8c3710fa309` as last verified.** User's GPT-OSS real inference test previously showed 1/4 in Discord; this website development has NOT interrupted it or triggered extra AI inference.

## Dashboard endpoints (AFTER dedicated authorization and deployment)

- GET `/command-center/` — requires session; otherwise redirect to Discord OAuth login.
- GET `/command-center/login` — redirects to Discord `identify` OAuth2 scope, uses CSRF state nonce.
- GET `/command-center/callback` — exchanges code server-side and grants access **only** if Discord user ID matches the existing `DISCORD_ALLOWED_USER_ID` secret.
- GET `/command-center/api/overview` — recent owner-only jobs, four-stage timeline, final artifact and current model label; no public D1 access.
- POST `/command-center/api/start` — owner-only, same-origin/CSRF checks, D1 single-active-slot safeguards.
- POST `/command-center/api/stop` — owner-only, same-origin/CSRF checks; cooperative STOP before new model inference.
- POST `/command-center/logout` — clears authenticated session.
- No public API tokens or Discord OAuth access tokens are retained in D1 or public pages.

The model label in the dashboard reflects **current configuration only**. Historical D1 jobs do not record their exact model, so old jobs should not be falsely labeled GPT-OSS or Llama. The current D1 retains a job for ~24 hours; long-term metrics need separate planning.

## Owner actions REQUIRED before publishing the website

**Do NOT share any OAuth client secret or session key in ChatGPT, GitHub source, screenshot, Discord messages or Cloudflare logs.**

1. In the existing Discord Developer Portal app **AI Relay Lab**, open **OAuth2 → Redirects**, add precisely:
   `https://steep-glitter-b5cddiscord-ai-relay-lab.ikkinotako2.workers.dev/command-center/callback`
2. Get the application's Discord OAuth **Client Secret**. In Cloudflare, for the **existing Discord Relay Worker only**, register a new *encrypted secret* named `DISCORD_OAUTH_CLIENT_SECRET`. Do **not** confuse with Discord Bot Token or public key.
3. Independently create a strong random **32+ character** private value and add it as a second encrypted Cloudflare Worker secret, `DASHBOARD_COOKIE_KEY` (prefer cryptographically random 32-byte hex). Do not paste its contents into GitHub or chat.
4. Preserve existing `DISCORD_PUBLIC_KEY`, `DISCORD_ALLOWED_USER_ID`, Workers AI `AI`, and `LOOP_DB`. New secret changes can create a new production Worker version and must be verified before release. Avoid actions mid-loop.
5. Before any website deployment, check Discord `/loop-status` for a terminal state (`completed`/`stopped`/`failed`), verify existing `/ask`, `/relay`, `/loop`, and confirm Cloudflare Free remains active. A global active-job count could not be confirmed via remote GitHub D1 read; use additional verified mechanism when available.
6. **Separate explicit approval** required for non-public version upload and live deployment with preflight and automatic rollback to the current user-tested GPT-OSS version. Do not run `wrangler deploy` directly. Test the OAuth login and API on a safe candidate before enabling traffic.

Once the secrets and redirect are configured, the user should reply **'OAuth設定完了'** without providing secret values.

## Roadmap for multiple chat/agent connections (NOT currently implemented)

The current agent loop is exactly **AI A (planner) → AI B (builder) → AI A → AI B**, using two roles of the **same Cloudflare-hosted GPT-OSS model**, with a single globally active job (max four inference calls). These are **not separate consumer ChatGPT chat sessions**.

For future 3+ agent/model connectors, introduce:

1. Operator-named agent profiles (model type, purpose, consent and quotas), with authorization.
2. Explicit routing edges showing which agent sends context to which, using a relay-run trace in D1. Do not infer unique chat identities from a model role alone.
3. Visual per-run handoff history, errors, cost/quota estimates, alerts, STOP and manual restart. Provide versioned schema migrations and owner-only data access.
4. Separate model/provider adapters and usage budgets only where the provider supports an authorized API. No automated consumer ChatGPT browser scraping or free-tier quota evasion.
5. An explicit deployment and rollback process after offline tests, then one verified real-browser login + one controlled live task.

Never claim the site or multiple-chat routing is live before a verified deployment.
