-- ONLY for a newly created Discord Relay Lab D1 database.
-- Never apply to a Project Love Machine database.
-- Unapplied until a separate dedicated D1 database is created and verified.
CREATE TABLE IF NOT EXISTS relay_loop_jobs (
  run_id TEXT PRIMARY KEY NOT NULL,
  requester_discord_id TEXT NOT NULL,
  task TEXT NOT NULL CHECK(length(task) BETWEEN 1 AND 1000),
  status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','stopped','failed','unknown')),
  next_role TEXT CHECK(next_role IN ('planner','builder') OR next_role IS NULL),
  round_number INTEGER NOT NULL DEFAULT 1 CHECK(round_number BETWEEN 1 AND 2),
  max_rounds INTEGER NOT NULL DEFAULT 2 CHECK(max_rounds BETWEEN 1 AND 2),
  -- Counts CLAIMED model calls, including failed/unknown attempts. Never exceed 4.
  calls_used INTEGER NOT NULL DEFAULT 0 CHECK(calls_used BETWEEN 0 AND 4),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  plan_output TEXT,
  previous_artifact TEXT,
  history_json TEXT NOT NULL DEFAULT '[]',
  lease_owner TEXT,
  lease_expires_at INTEGER,
  stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1)),
  last_error_code TEXT,
  -- Only ONE active job globally for the free-tier experiment. NULL releases slot.
  active_slot INTEGER UNIQUE CHECK(active_slot IS NULL OR active_slot = 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_loop_jobs_status_lease
  ON relay_loop_jobs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS relay_loop_jobs_user_time
  ON relay_loop_jobs(requester_discord_id, created_at DESC);
CREATE INDEX IF NOT EXISTS relay_loop_jobs_expires
  ON relay_loop_jobs(expires_at);
