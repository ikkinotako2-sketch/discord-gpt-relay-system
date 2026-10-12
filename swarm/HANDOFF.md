# Handoff contract and access-limit behavior

Persist run ID, owner, task, cycle cap, next stage, revision, status, lease, checkpoints, handoff history and pending approval. No secrets in output or public source.

Before inference: verify STOP, permissions, valid model allowance; make one atomic claim. After confirmed completion: persist a new checkpoint, then wait for next authorized Cron tick.

If no allowance BEFORE claim: quota_wait and later resume when capacity recovers. If timeout or outcome unknown AFTER claim: unknown and operator review, NEVER an automatic repeat of a possibly charged inference. Never use account rotation or new ChatGPT conversations to evade access limits.

A Command Center may display all six roles, but it must separate live data from a simulation, and must not describe model roles as independent consumer ChatGPT sessions.

Existing Project Love Machine/YouTube repositories, Cloudflare Workers, D1 IDs, Secrets and Actions must remain untouched.
