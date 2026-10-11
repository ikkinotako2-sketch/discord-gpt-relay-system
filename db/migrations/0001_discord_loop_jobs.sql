-- Reference migration for a NEW Discord Relay Lab D1 database only.
-- DO NOT apply to any Project Love Machine database.
-- Not yet deployed. Bind it only after explicit confirmation of DB isolation.
CREATE TABLE IF NOT EXISTS relay_loop_jobs (
    run_id TEXT PRIMARY KEY NOT NULL,
    requester_discord_id TEXT NOT NULL,
    task TEXT NOT NULL CHECK (length(task) BETWEEN 1 AND 1000),
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','claimed','completed','stopped','failed','unknown')),
    next_role TEXT CHECK (next_role IN ('planner','builder') OR next_role IS NULL),
    round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number BETWEEN 1 AND 2),
    max_rounds INTEGER NOT NULL DEFAULT 2 CHECK (max_rounds BETWEEN 1 AND 2),
    calls_used INTEGER NOT NULL DEFAULT 0 CHECK (calls_used BETWEEN 0 AND 4),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    plan_output TEXT,
    previous_artifact TEXT,
    history_json TEXT NOT NULL DEFAULT '[]',
    lease_owner TEXT,
    lease_expires_at INTEGER,
    stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0,1)),
    last_error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_loop_jobs_status_expiry
  ON relay_loop_jobs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS relay_loop_jobs_owner_created
  ON relay_loop_jobs(requester_discord_id, created_at);
CREATE INDEX IF NOT EXISTS relay_loop_jobs_expiry
  ON relay_loop_jobs(expires_at);
-- CAS rule for the future D1 adapter (NOT an executable migration):
-- UPDATE relay_loop_jobs SET revision = revision + 1, ...
-- WHERE run_id = ? AND revision = ? AND status = 'queued';
-- Require exactly one changed row before performing the next action.
