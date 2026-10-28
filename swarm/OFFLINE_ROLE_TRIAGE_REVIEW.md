# Offline role triage experiment — REVIEW ONLY

**Status:** not wired to any Worker, bot, scheduler, D1, provider, or production job. This is an advisory, zero-external-call experiment. The existing six sequential stages are unchanged: director → researcher → developer → reviewer → improver → archivist. It is **not** a substitute for the once-only six-call controller, original historical UNKNOWN preservation, independent Watchdog, owner OAuth+CSRF, or approval.

## Why a deterministic first pass

Simple descriptions can be classified with fixed rules without an LLM or provider key. Mixed or unfamiliar tasks return director-led human review; descriptions mentioning deployment, publishing, credentials, data deletion, billing, or production require owner review. A role recommendation never grants permissions. Input text is bounded and is not included in output/logs. This module cannot call an AI model, Discord, or Cloudflare.

## Offline test

`node --test swarm/offline-role-triage.test.mjs` (Node 22+). The curated fixtures measure only these fixed patterns, not real-world routing accuracy or quality. Measure real-world savings against a reviewed benchmark before adopting additional routing; all nonfree external model integrations remain out of scope.

## JEV / framework assessment (not installed)

“Jev” is not a unique official model: there are multiple unrelated community routing projects. None is required to run this experiment. Adding Jev, LangGraph or Agents SDK today would add dependencies and potentially credentials, model calls or tracing. Evaluate only in a separate approved offline experiment; never use them to bypass free-tier checks, model entitlement, D1 once-only claims, STOP or human approval.

## Evidence required before any live adoption

1. Independent run-level original UNKNOWN full-row SHA-256 pin and live D1 read-only checks.
2. Current provider-wide Free Neurons remainder and exact model entitlement, plus external-run exclusion.
3. Owner-validated task, HMAC OAuth+CSRF, explicit bounded consent and protected D1 backup/restore.
4. Independently prearmed Watchdog and real restoration verification.
5. Separate reviewed production integration PR, live safety assessment and owner approval.

This proposal does not fulfill any of those gates. No retry of historical UNKNOWN; no production deployment or model inference.
