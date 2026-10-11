# Cloudflare integration plan (NOT DEPLOYED)

This repository contains a standalone prototype in `worker-relay.mjs`. It handles `/relay` only, so **do not paste it over the existing live Worker**, or `/ask` will stop working.

## Prerequisites
1. Existing `/ask` still answers on Discord (user-reported).
2. Remove the temporary `/__register_ask` handler from the live Worker.
3. Delete `SETUP_KEY` and unused `DISCORD_BOT_TOKEN` bindings after removal, test `/ask`.
4. Ensure Cloudflare Worker has an `AI` binding and `DISCORD_PUBLIC_KEY` secret.

## Proposed integration
- Use Wrangler GitHub Actions deployment in a separately reviewed workflow, with scoped Cloudflare credentials.
- Merge the `/relay` command dispatch into the current live Worker preserving the `/ask` handler.
- Register `relay` with the official Discord application-commands API after authentication is configured.
- Never expose a public unauthenticated registration endpoint.
- Run smoke tests for both commands before enabling further automation.
- The worker uses two sequential Workers AI calls, *not* two real ChatGPT consumer chat sessions.
- Free quotas are limited, and the workflow does not guarantee zero ongoing costs.
