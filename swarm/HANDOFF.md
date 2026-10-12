# Handoff contract and access-limit behavior

Persist run ID, owner, task, cycle cap, next stage, revision, status, lease, checkpoints, handoff history and pending approval. No secrets in output or public source.

Before inference: verify STOP, permissions, valid model allowance; make one atomic claim. After confirmed completion: persist a new checkpoint, then wait for next authorized Cron tick.

If no allowance BEFORE claim: quota_wait and later resume when capacity recovers. If timeout or outcome unknown AFTER claim: unknown and operator review, NEVER an automatic repeat of a possibly charged inference. Never use account rotation or new ChatGPT conversations to evade access limits.

A Command Center may display all six roles, but it must separate live data from a simulation, and must not describe model roles as independent consumer ChatGPT sessions.

Existing Project Love Machine/YouTube repositories, Cloudflare Workers, D1 IDs, Secrets and Actions must remain untouched.

## Export into a new authorized conversation

An authenticated owner can GET `/command-center/api/swarm/handoff` (after staged wiring and production approval) and copy the generated Markdown into a new conversation, or save a structured JSON file. This exports saved work status, last checkpoint, confirmed stage history and the next role, **not** private ChatGPT conversation history. Unknown outcomes explicitly require manual inspection rather than auto-retry. The record lasts only as long as the dedicated D1 retention policy allows.
