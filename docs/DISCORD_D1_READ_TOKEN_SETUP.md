# Discord-only D1 preflight: account-scoped read token (owner setup)

Status: **NOT CONFIGURED / NO RELEASE RETRY AUTHORIZED** until separately confirmed.

## Root cause evidence
A previously approved isolated release stopped before uploading any new Worker version because the remote D1 SELECT exited 1: [GitHub Actions run 38223313416](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38223313416).

An independent, **read-only** Cloudflare API probe against the exact dedicated Discord D1 UUID, using the same GitHub Worker token, got HTTP 401, Cloudflare error code 10000: [run 38224046749](https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/actions/runs/38224046749). That indicates an auth/scope problem for the D1 API. It does not prove that the database has active jobs. No D1 contents changed.

## Separate credentials, never replace the existing Worker token

1. In Cloudflare account `6c8ccd6aface937ab5dabef61cb64534`, create a **new, separate** API token scoped to that **account only**, permission **Account → D1 → Read** (no Write, Edit, Workers deploy, or other permissions). Use an appropriate short expiration if your workflow permits.
2. **Important scope limitation:** Cloudflare's D1 Read scope is account-level, not necessarily limited to one D1 database. Do not grant it at all if other sensitive D1 databases share this account and that visibility is unacceptable. Use an isolated Cloudflare account instead; do not move or change any existing production D1 automatically.
3. In GitHub repository `ikkinotako2-sketch/discord-gpt-relay-system` → Settings → Secrets and variables → Actions → New repository secret, add the token as `DISCORD_D1_READ_TOKEN`. Never paste it into issues, PRs, chat, screenshots, or workflow code.
4. Keep **existing** `CLOUDFLARE_API_TOKEN` untouched. The release workflow uses it for Worker version/secret checks and the dedicated `DISCORD_D1_READ_TOKEN` **only in two read-only COUNT queries**. GitHub Secrets values are never printed.
5. A missing or invalid `DISCORD_D1_READ_TOKEN`, nonzero active job count, or malformed D1 response must stop the production release before promotion. Do not disable this protection.
6. The previous one-shot release authorization is spent. Before retrying, get **fresh** owner confirmation of no concurrent Discord Worker changes or new loops, verify idle GitHub Actions, and obtain fresh explicit consent to trigger a new one-shot release.

## Safety boundaries
- Exact Worker: `steep-glitter-b5cddiscord-ai-relay-lab`
- Exact D1: `discord-relay-loop-state`, UUID `d80b08a4-0ff7-4320-9575-0d3c55cf7aba`
- Query (twice, before inactive upload and immediately before promotion):
  `SELECT COUNT(*) AS active_jobs FROM relay_loop_jobs WHERE status IN ('queued','claimed') OR active_slot = 1;`
- No D1 writes, migrations, bot commands, model inference, new Cron, other Cloudflare Workers, YouTube or Project Love Machine modifications.
- Site publication is for the **existing 2-role Command Center only**. The separate 6-role Draft PR #1 is not approved or merged.
- Dashboard OAuth still needs owner's post-deployment browser login test.
