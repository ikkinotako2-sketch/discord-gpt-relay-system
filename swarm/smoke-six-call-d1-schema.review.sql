-- OFFLINE-REVIEW-ONLY. NEVER apply to production D1 without a fresh, separate owner approval.
-- Depends on the existing Discord-only swarm_budget_days table. Does not change
-- swarm_jobs or the preserved historical UNKNOWN row.
-- No integration into any GitHub deployment or migration workflow.
CREATE TABLE IF NOT EXISTS swarm_smoke_control_runs (
 run_id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 task_receipt_id TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL,
 worker_name TEXT NOT NULL,
 database_id TEXT NOT NULL,
 baseline_version TEXT NOT NULL,
 smoke_version TEXT NOT NULL,
 phase TEXT NOT NULL DEFAULT 'PENDING'
  CHECK(phase IN ('PENDING','ACTIVE','RESTORE_REQUIRED','RESTORED','BLOCKED')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),
 completed INTEGER NOT NULL DEFAULT 0 CHECK(completed BETWEEN 0 AND 6),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1)),
 in_flight_index INTEGER CHECK(in_flight_index IS NULL OR in_flight_index BETWEEN 0 AND 5),
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 CHECK(completed<=attempts),
 CHECK(expires_at_ms>created_at_ms AND expires_at_ms-created_at_ms<=1200000),
 CHECK(baseline_version<>smoke_version)
);
-- RESTORE_REQUIRED is retained, not reopened merely to admit another smoke.
CREATE UNIQUE INDEX IF NOT EXISTS swarm_smoke_control_one_open
 ON swarm_smoke_control_runs((1)) WHERE phase IN ('ACTIVE','RESTORE_REQUIRED');

CREATE TABLE IF NOT EXISTS swarm_smoke_control_claims (
 run_id TEXT NOT NULL REFERENCES swarm_smoke_control_runs(run_id),
 stage_index INTEGER NOT NULL CHECK(stage_index BETWEEN 0 AND 5),
 owner_id TEXT NOT NULL,
 utc_day TEXT NOT NULL,
 claimed_at_ms INTEGER NOT NULL,
 settled_at_ms INTEGER,
 state TEXT NOT NULL DEFAULT 'CLAIMED'
  CHECK(state IN ('CLAIMED','FINAL_VERIFIED','UNKNOWN')),
 PRIMARY KEY(run_id,stage_index),
 CHECK((state='CLAIMED' AND settled_at_ms IS NULL) OR
       (state<>'CLAIMED' AND settled_at_ms IS NOT NULL))
);

-- INSERT of an eligible claim and the actual local-day budget reservation
-- must succeed or fail together. SQLite trigger statements are atomic with
-- their parent INSERT; constraint or RAISE(ABORT) rolls back all effects.
CREATE TRIGGER IF NOT EXISTS swarm_smoke_control_claim_atomic
AFTER INSERT ON swarm_smoke_control_claims
BEGIN
 SELECT CASE WHEN NEW.utc_day<>strftime('%Y-%m-%d', NEW.claimed_at_ms/1000,'unixepoch')
    THEN RAISE(ABORT,'SMOKE_UTC_DAY_MISMATCH') END;
 INSERT INTO swarm_budget_days(owner_id,utc_day,cap,reserved,updated_at)
  VALUES(NEW.owner_id,NEW.utc_day,6,0,NEW.claimed_at_ms)
  ON CONFLICT(owner_id,utc_day) DO NOTHING;
 UPDATE swarm_budget_days SET reserved=reserved+1,updated_at=NEW.claimed_at_ms
  WHERE owner_id=NEW.owner_id AND utc_day=NEW.utc_day
    AND reserved<MIN(cap,6);
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'SMOKE_LOCAL_CAP_REACHED') END;
 UPDATE swarm_smoke_control_runs
 SET attempts=attempts+1,revision=revision+1,
     in_flight_index=NEW.stage_index,updated_at_ms=NEW.claimed_at_ms
 WHERE run_id=NEW.run_id AND owner_id=NEW.owner_id
   AND phase='ACTIVE' AND attempts=NEW.stage_index
   AND completed=attempts AND stop_requested=0 AND in_flight_index IS NULL
   AND NEW.claimed_at_ms>=created_at_ms AND NEW.claimed_at_ms<expires_at_ms;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'SMOKE_CLAIM_CAS_CONFLICT') END;
END;

-- Settling is also one atomic DB statement. UNKNOWN consumes the claim and
-- requires restore; never permits reissue of that or subsequent stage.
CREATE TRIGGER IF NOT EXISTS swarm_smoke_control_settle_atomic
AFTER UPDATE OF state ON swarm_smoke_control_claims
WHEN OLD.state='CLAIMED' AND NEW.state IN ('FINAL_VERIFIED','UNKNOWN')
BEGIN
 UPDATE swarm_smoke_control_runs
 SET revision=revision+1,
     completed=completed+CASE WHEN NEW.state='FINAL_VERIFIED' THEN 1 ELSE 0 END,
     in_flight_index=NULL,
     phase=CASE WHEN stop_requested=1 OR NEW.state='UNKNOWN' OR NEW.stage_index=5 OR
                   NEW.settled_at_ms>=expires_at_ms
                THEN 'RESTORE_REQUIRED' ELSE 'ACTIVE' END,
     updated_at_ms=NEW.settled_at_ms
 WHERE run_id=NEW.run_id AND phase='ACTIVE'
   AND in_flight_index=NEW.stage_index AND attempts=NEW.stage_index+1
   AND completed=NEW.stage_index AND
   NEW.settled_at_ms>=NEW.claimed_at_ms;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'SMOKE_SETTLE_CAS_CONFLICT') END;
END;
