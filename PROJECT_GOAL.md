# Discord GPT Relay System — Fixed Goal

## Primary goal
Use Discord as a relay to hand tasks and context from one GPT-powered chat/agent to another, repeatedly, so they can collaborate on automation projects with minimal human intervention.

The end goal is **GPT chat-to-chat automation**, not merely a single Discord question-answer bot.

## Terminology and constraints
- ChatGPT consumer chat conversations are not assumed to expose an automation API.
- A working first prototype may use multiple independent model calls, each with its own role and transcript, through an authorized API.
- Do not automate the consumer ChatGPT website or evade access/rate limits.
- Prefer official supported integrations. Explicitly distinguish real ChatGPT chat sessions from simulated agent conversations.
- Budget target: $0; stop safely when free quotas are reached.
- Isolate from Project Love Machine: no shared tokens, workers, repositories, or production integrations.
- GitHub is source of truth; Cloudflare Workers and Discord are runtime interfaces.
- No secrets in code, messages, git history, CI logs or screenshots.
- No autonomous production publishing, external account changes, payments, or deployment without explicit approval.

## Milestones
1. Discord /ask bot answers a question: **USER-REPORTED PASS** (existing Cloudflare Worker, not yet under GitHub version control).
2. Clean up temporary registration endpoint and setup credentials: **PENDING**.
3. Bring source under GitHub control, add repeatable offline tests: **IN PROGRESS**.
4. Relay a task from Agent A to Agent B with a documented handoff envelope: **PENDING**.
5. Add checker Agent C, traceability, max 3 iterations, stop/retry semantics: **PENDING**.
6. Configure GitHub Actions and controlled Cloudflare deployment: **PENDING**.
7. Test run while Chromebook is closed: **PENDING**.

## Definition of a successful relay
- Agent A receives a bounded user task and produces a structured handoff.
- Agent B receives A's output and can continue the task without manual copy/paste.
- Discord shows the run ID, each role, result, and stop reason.
- At most 3 rounds, no secrets in messages, explicit human approval for external changes.
- Actual AI API and real Discord verification are separately recorded.

## Status discipline
Every update should state: DONE / IN PROGRESS / BLOCKED, verified evidence, next action, and whether running code is affected.
Never report a step as deployed or tested based only on a code draft.
