# Discord GPT Relay System

Goal: **Use Discord to relay a task between multiple GPT-powered chat/agent contexts in an automated, bounded workflow.**

See [PROJECT_GOAL.md](PROJECT_GOAL.md) for the non-negotiable mission and milestone tracking.

## Current state
The user reports an independently hosted Cloudflare Worker Discord bot answering Japanese questions via `/ask`. This repository starts as a separate source-control and test foundation. **It is not yet deployed and is not the source of the running Worker.**

## Safety and cost
- No real secrets, Bot Tokens or private transcripts in GitHub.
- The repository may be public: treat everything committed as public.
- Only use supported AI/Discord APIs; do not scrape consumer ChatGPT conversations.
- All future loops must have a hard iteration cap, no publish/write privileges by default, and a manual stop mechanism.
- Never touch Project Love Machine.

## Next
1. Remove the temporary `/__register_ask` endpoint from the existing Worker and delete its `SETUP_KEY` and unneeded `DISCORD_BOT_TOKEN`.
2. Verify `/ask` still answers.
3. Implement a stateless A → B handoff test; then connect runtime with a reviewed deployment workflow.

Do not add real Cloudflare account identifiers, secrets, or personal data to public commits.
