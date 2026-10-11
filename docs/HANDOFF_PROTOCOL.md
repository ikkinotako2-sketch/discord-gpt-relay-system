# Handoff protocol v0 (design)

Each stage receives a JSON document carrying:
- `run_id`: non-secret unique identifier
- `iteration`: integer starting at 1
- `max_iterations`: hard cap, initially 3
- `task`: user-authorized task (remove sensitive data)
- `role`: `planner`, `builder`, or `reviewer`
- `context`: short previous-stage summary
- `artifact`: draft or test result
- `status`: `pending`, `completed`, `blocked`, or `stopped`

Acceptance constraints:
- No credentials or raw user private conversations.
- Bound messages by length, cap iterations, reject unknown fields as appropriate.
- Avoid duplicate processing by run_id + iteration + role.
- Output errors and stop reasons in Discord.
- No git push, deploy, SNS posting, or external writes without separately approved workflow.
- First relay experiment is local/mock-only, not a claim of live GPT chat automation.
