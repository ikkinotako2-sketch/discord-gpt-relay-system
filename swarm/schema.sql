-- STAGED ONLY. Independent owner approval required before applying to Discord-only D1.
-- Does not modify the existing relay_loop_jobs table.
CREATE TABLE IF NOT EXISTS swarm_jobs (
  run_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, task TEXT NOT NULL,
  cycles INTEGER NOT NULL CHECK(cycles BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','claimed','quota_wait','completed','stopped','unknown')),
  calls_used INTEGER NOT NULL DEFAULT 0 CHECK(calls_used BETWEEN 0 AND 18),
  revision INTEGER NOT NULL DEFAULT 0,
  history_json TEXT NOT NULL DEFAULT '[]', checkpoint TEXT NOT NULL DEFAULT '',
  stop_requested INTEGER NOT NULL DEFAULT 0,
  active_slot INTEGER CHECK(active_slot IS NULL OR active_slot=1),
  lease_owner TEXT, lease_expires_at INTEGER,
  last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS swarm_single_active_job ON swarm_jobs(active_slot) WHERE active_slot=1;
CREATE INDEX IF NOT EXISTS swarm_owner_created ON swarm_jobs(owner_id,created_at DESC);
