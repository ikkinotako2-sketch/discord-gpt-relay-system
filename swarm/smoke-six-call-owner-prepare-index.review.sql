-- OFFLINE-REVIEW ONLY. NEVER apply without separate Cloudflare D1 migration approval.
-- Complements smoke-six-call-d1-schema.review.sql (unapplied). New pending
-- intent cannot coexist with another pending/active/restore-required smoke.
-- A single SQLite uniqueness constraint avoids check-then-insert races.
-- Historical swarm_jobs UNKNOWN rows are untouched.
CREATE UNIQUE INDEX IF NOT EXISTS swarm_smoke_control_one_pending_or_open
 ON swarm_smoke_control_runs((1))
 WHERE phase IN ('PENDING','ACTIVE','RESTORE_REQUIRED');
