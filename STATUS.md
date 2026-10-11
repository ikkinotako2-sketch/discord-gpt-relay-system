# AI Relay Lab — verified status (2026-10-11)

## CURRENT: WORKER_LIVE / DISCORD_RELAY_REGISTERED / END_TO_END_MANUAL_TEST_PASS

User confirmed that both `/ask` and `/relay` returned successful answers in the AI Relay Lab Test Discord server. The user reported noticeable response latency, but no seconds were measured; the two sequential model calls are a plausible reason for delay.

### Latency improvement staged in GitHub, NOT deployed
- `worker-relay.mjs` now has lower per-stage output limits: planner 260, builder 320, /ask 240 (previous 450 and 350); lower maximum output can reduce worst-case inference duration, but speedup is NOT guaranteed.
- Add privacy-safe per-AI-stage timing logs (role and duration only) and total approximate AI time in `/relay` answers.
- `worker-relay.test.mjs` checks the caps and elapsed-time display.
- **The live Worker still runs the previously deployed version** `82537b42-90d1-424d-92d4-9dcc5b1309de`. Do NOT claim staged code is active.
- Releasing any updated version requires a separate dry-run, inactive upload, then explicit authorized promotion with validation and rollback. Do not use a blind wrangler deploy.



### Verified evidence (GitHub Actions)
- **Release 38138045023:** preflight passed; Cloudflare production switched to version `82537b42-90d1-424d-92d4-9dcc5b1309de` at 100%. Immediate health check failed due to a missing expected response text, so the workflow ended FAILURE **after the production write**; Discord command registration was skipped.
- **Recovery run 38139700266:** SUCCESS. GitHub runner GET request to the production Worker returned HTTP 200 with body `Discord GPT Relay candidate (not deployed).` (a stale status label hardcoded in the Worker); POST with no Discord signature returned HTTP 401; exact Discord AI Relay Lab Bot Token validated; Discord command `/relay` creation returned HTTP **201**.
- **Offline test suite:** 13/13 PASS on earlier upload and release workflows. The latest GitHub tests after the recovery configuration change also passed (run 38139347691).
- The recovery run **did not redeploy the Worker**. It only checked live behavior and registered the command.
- Public repository: `ikkinotako2-sketch/discord-gpt-relay-system`.

### Next checks
1. The user has confirmed `/ask` and `/relay` both returned; measure actual response time after the optional new version is safely deployed.
3. If either command fails, collect its response and the relevant Cloudflare Worker logs **without exposing tokens or private data**; do not rerun a production deployment blindly.
4. **Remove or rotate the previously exposed Cloudflare SETUP_KEY**. The new Worker code does not contain the temporary registration route `/__register_ask`. The old Cloudflare `DISCORD_BOT_TOKEN` is no longer needed by the current runtime, provided the command registration has succeeded. **Preserve `DISCORD_PUBLIC_KEY` and Workers AI binding `AI`.** Secret changes can affect deployed versions; verify `/ask` and `/relay` afterward.
5. Later: implement durable and authorized handoff among **actual GPT-powered agents**, state/retry, monitoring, and opt-in external integrations. The current implementation is *only* two sequential Cloudflare Workers AI calls to a Llama model, **not** consumer ChatGPT sessions, and is not a self-sustaining autonomous network.

### Safety and rollback
- Production Worker: `steep-glitter-b5cddiscord-ai-relay-lab`.
- Currently deployed known version from release logs: `82537b42-90d1-424d-92d4-9dcc5b1309de` (follow-up recovery GET 200 confirmed its expected body).
- Last pre-release version: `d693825b-fb22-4fdf-a55e-a7f511f4ee29`. Manual emergency rollback workflow: `.github/workflows/rollback-relay.yml`. Do not rollback without evidence; the earlier version may contain the temporary registration endpoint.
- Registration and health recheck (no deployment): `.github/workflows/register-relay.yml`; no manual string input necessary.
- The duplicate partially-successful release workflow was removed to avoid further erroneous redeployments.
- Keep tokens out of screenshots, messages, git commits, Discord, and logs. The GitHub repository is public and separated from Project Love Machine.
- Cloudflare free quota and limits apply. No assertion of limitless execution, paid/free upgrade, or unattended workflow beyond implemented bounds.
