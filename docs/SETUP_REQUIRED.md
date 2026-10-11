# Remaining user-owned setup (no TinyFish)

## Current status
- GitHub can hold and test the code without access to Cloudflare.
- Production deployment is intentionally **manual-only**. No workflow will deploy on push.
- The live /ask Worker is unchanged until a manual deployment happens.
- Current relay uses two Workers AI calls, not two browser ChatGPT conversations.

## Security cleanup of the live Worker
1. Verify that the temporary /__register_ask route has been removed from the live Worker. GitHub code does not contain that route, but it cannot remove it from Cloudflare without deployment.
2. Remove SETUP_KEY and unnecessary DISCORD_BOT_TOKEN from live Worker settings after confirming command registration is no longer needed. If either has been exposed in screenshots, rotate/revoke it first.
3. Keep DISCORD_PUBLIC_KEY and the Workers AI binding AI.
4. Verify /ask still answers.

## Manual-only GitHub -> Cloudflare setup
1. In GitHub Settings > Environments add a production environment, enable required reviewers when available.
2. Add GitHub Actions secrets CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Use a narrowly scoped token restricted to updating the single target Worker where the provider allows it. Never commit or send token to chat.
3. Review wrangler.toml and confirm the Worker name matches the live Worker before deploying.
4. In GitHub Actions, manually select Manual Cloudflare Deployment > Run workflow.
5. Verify /ask and GET health response.
6. Register /relay using the Discord official application command API, via a controlled authenticated local/API client (not an unguarded public Worker route).
7. Verify /relay. Keep interaction permissions restricted to experiment server.

## Known constraints
- Discord deferred interaction token is time-limited. The two model calls may exceed the interaction lifecycle; add a durable queue before long/indefinite loops.
- Workers AI free quota is limited.
- No payment, no self-modifying production deployment, no Discord or Cloudflare mutations through this repository without explicit approval.
