-- OFFLINE REVIEW ONLY; do not run on production D1 without owner approval.
-- Requires prior six-call run/claim tables and output artifacts migration.
-- Does not touch the pre-existing swarm_jobs UNKNOWN or any old job row.
CREATE TABLE IF NOT EXISTS swarm_smoke_control_owner_tasks (
 run_id TEXT PRIMARY KEY REFERENCES swarm_smoke_control_runs(run_id),
 owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 15 AND 22),
 task_receipt_id TEXT NOT NULL UNIQUE,
 original_task TEXT NOT NULL CHECK(length(trim(original_task)) BETWEEN 1 AND 1000),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=1000000000000)
);
CREATE TRIGGER IF NOT EXISTS swarm_smoke_control_owner_task_scope
BEFORE INSERT ON swarm_smoke_control_owner_tasks
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM swarm_smoke_control_runs r
  WHERE r.run_id=NEW.run_id AND r.owner_id=NEW.owner_id
   AND r.task_receipt_id=NEW.task_receipt_id AND r.phase='PENDING'
   AND r.stop_requested=0 AND r.attempts=0 AND r.completed=0
   AND NEW.created_at_ms>=r.created_at_ms
   AND NEW.created_at_ms<r.expires_at_ms
 ) THEN RAISE(ABORT,'OWNER_TASK_NOT_PINNED_PENDING_RUN') END;
END;
CREATE TRIGGER IF NOT EXISTS swarm_smoke_control_owner_task_no_update
BEFORE UPDATE ON swarm_smoke_control_owner_tasks
BEGIN
 SELECT RAISE(ABORT,'OWNER_TASK_IMMUTABLE_NO_UPDATE');
END;
CREATE TRIGGER IF NOT EXISTS swarm_smoke_control_owner_task_no_delete
BEFORE DELETE ON swarm_smoke_control_owner_tasks
BEGIN
 SELECT RAISE(ABORT,'OWNER_TASK_IMMUTABLE_NO_DELETE');
END;
