-- OFFLINE REVIEW ONLY; not applied to Cloudflare D1.
-- Separate owner approval, backup and rollback needed before live migration.
-- Preserves original swarm_jobs UNKNOWN and all prior six-call schema objects.
CREATE TABLE IF NOT EXISTS swarm_smoke_control_outputs (
 run_id TEXT NOT NULL,
 stage_index INTEGER NOT NULL CHECK(stage_index BETWEEN 0 AND 5),
 owner_id TEXT NOT NULL,
 task_receipt_id TEXT NOT NULL,
 claim_revision INTEGER NOT NULL CHECK(claim_revision>=1),
 digest_sha256 TEXT NOT NULL CHECK(length(digest_sha256)=64),
 receipt_id TEXT NOT NULL CHECK(length(receipt_id)=46),
 final_text TEXT NOT NULL CHECK(length(final_text) BETWEEN 1 AND 2200),
 saved_at_ms INTEGER NOT NULL CHECK(saved_at_ms>=1000000000000),
 PRIMARY KEY(run_id,stage_index),
 FOREIGN KEY(run_id,stage_index)
  REFERENCES swarm_smoke_control_claims(run_id,stage_index)
);
