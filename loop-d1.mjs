// D1-backed, single-active-job AI loop. NO D1 database or cron is deployed by adding this file.
// Every CLAIM increments calls_used before inference. Expired CLAIMS become unknown, NEVER retried.
export const MAX_ROUNDS = 2;
export const MAX_CALLS = 4;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const CLAIM_LEASE_MS = 5 * 60 * 1000;

const dbRequired = db => {
  if (!db?.prepare) throw Error('Discord-only LOOP_DB binding is missing');
  return db;
};
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id);
const isSnowflake = id => typeof id === 'string' && /^\d{15,22}$/.test(id);
const validateTask = task => typeof task === 'string' && task.trim().length > 0 && task.length <= 1000;
const rowChanged = result => (result?.meta?.changes ?? result?.changes ?? 0) === 1;

export async function createDurableLoop(db, { runId, requesterId, task, now = Date.now() }) {
  dbRequired(db);
  if (!validId(runId) || !isSnowflake(requesterId) || !validateTask(task)) throw TypeError('Invalid loop request');
  try {
    await db.prepare(`INSERT INTO relay_loop_jobs
    (run_id,requester_discord_id,task,status,next_role,round_number,max_rounds,
     calls_used,revision,history_json,stop_requested,active_slot,created_at,updated_at,expires_at)
    VALUES (?,?,?,'queued','planner',1,2,0,0,'[]',0,1,?,?,?)`)
      .bind(runId,requesterId,task.trim(),now,now,now+RETENTION_MS).run();
    return { created: true, runId };
  } catch {
    // Do not expose database internals to Discord or logs.
    const existing = await db.prepare('SELECT run_id,requester_discord_id FROM relay_loop_jobs WHERE run_id=?').bind(runId).first();
    if (existing?.requester_discord_id === requesterId) return { created:false, runId };
    return { created:false, busy:true };
  }
}

export async function getLatestLoop(db, requesterId) {
  dbRequired(db);
  if (!isSnowflake(requesterId)) throw TypeError('Invalid requester');
  return db.prepare(`SELECT run_id,status,next_role,round_number,max_rounds,calls_used,
    revision,stop_requested,previous_artifact,last_error_code,created_at,updated_at
    FROM relay_loop_jobs WHERE requester_discord_id=? ORDER BY created_at DESC LIMIT 1`)
    .bind(requesterId).first();
}

export async function requestDurableStop(db, requesterId, now=Date.now()) {
  dbRequired(db);
  if (!isSnowflake(requesterId)) throw TypeError('Invalid requester');
  const active = await db.prepare(`SELECT run_id,status FROM relay_loop_jobs
    WHERE requester_discord_id=? AND status IN ('queued','claimed') ORDER BY created_at DESC LIMIT 1`)
    .bind(requesterId).first();
  if (!active) return {found:false};
  if (active.status==='queued') {
    const r = await db.prepare(`UPDATE relay_loop_jobs SET status='stopped',next_role=NULL,
      active_slot=NULL, stop_requested=1,revision=revision+1,updated_at=?
      WHERE run_id=? AND status='queued'`).bind(now,active.run_id).run();
    return { found:true, status:rowChanged(r)?'stopped':'pending' };
  }
  // Running model calls cannot be interrupted remotely. Their output is discarded
  // once they finish, or the lease expiry resolves the job to stopped.
  const r = await db.prepare(`UPDATE relay_loop_jobs SET stop_requested=1,updated_at=?
    WHERE run_id=? AND status='claimed'`).bind(now,active.run_id).run();
  return {found:true,status:rowChanged(r)?'stop_requested':'pending'};
}

export async function expireStaleClaims(db, now=Date.now()) {
  dbRequired(db);
  await db.prepare(`UPDATE relay_loop_jobs SET
    status=CASE WHEN stop_requested=1 THEN 'stopped' ELSE 'unknown' END,
    next_role=NULL,active_slot=NULL,lease_owner=NULL,lease_expires_at=NULL,
    revision=revision+1,updated_at=?,last_error_code='CLAIM_EXPIRED'
    WHERE status='claimed' AND lease_expires_at<=?`).bind(now,now).run();
  await db.prepare(`UPDATE relay_loop_jobs SET status='stopped',next_role=NULL,
    active_slot=NULL,revision=revision+1,updated_at=?,last_error_code='JOB_EXPIRED'
    WHERE status='queued' AND expires_at<=?`).bind(now,now).run();
  // No prompt or generated data retained after expiry.
  await db.prepare(`DELETE FROM relay_loop_jobs WHERE expires_at<=?
    AND status IN ('completed','stopped','failed','unknown')`).bind(now).run();
}

export async function claimOneLoopStep(db, now=Date.now(), leaseOwner=crypto.randomUUID()) {
  dbRequired(db);
  await expireStaleClaims(db, now);
  // SQLite/D1 UPDATE RETURNING atomically elects at most one owner.
  const claimed = await db.prepare(`UPDATE relay_loop_jobs
    SET status='claimed',revision=revision+1,calls_used=calls_used+1,
    lease_owner=?,lease_expires_at=?,updated_at=?
    WHERE run_id=(SELECT run_id FROM relay_loop_jobs
      WHERE status='queued' AND stop_requested=0 AND expires_at>? AND calls_used<max_rounds*2
      ORDER BY created_at ASC LIMIT 1)
    AND status='queued' AND stop_requested=0
    RETURNING *`)
    .bind(leaseOwner,now+CLAIM_LEASE_MS,now,now).first();
  return claimed ?? null;
}

export async function commitLoopOutput(db, claimed, text, now=Date.now()) {
  dbRequired(db);
  if (!claimed || claimed.status!=='claimed') throw Error('Not a claimed step');
  if (typeof text!=='string' || !text.trim() || text.length>3000) {
    await failLoopClaim(db,claimed,'INVALID_MODEL_OUTPUT',now);
    return {status:'failed'};
  }
  const wasPlanner = claimed.next_role==='planner';
  const wasBuilder = claimed.next_role==='builder';
  if (!wasPlanner && !wasBuilder) throw Error('Invalid loop role');
  let history;
  try {history=JSON.parse(claimed.history_json)} catch {throw Error('Invalid saved history')}
  if (!Array.isArray(history) || history.length>=MAX_CALLS) throw Error('Invalid history');
  history.push({round:claimed.round_number,role:claimed.next_role,output:text.trim()});
  const done = wasBuilder && claimed.round_number>=claimed.max_rounds;
  const nextRole = done?null:(wasPlanner?'builder':'planner');
  const nextRound = wasBuilder && !done ? claimed.round_number+1 : claimed.round_number;
  const nextStatus = done?'completed':'queued';
  const plan = wasPlanner?text.trim():(wasBuilder?null:claimed.plan_output);
  const artifact = wasBuilder?text.trim():claimed.previous_artifact;
  const r=await db.prepare(`UPDATE relay_loop_jobs SET
    status=?, next_role=?,round_number=?,plan_output=?,previous_artifact=?,
    history_json=?,lease_owner=NULL,lease_expires_at=NULL,active_slot=?,
    revision=revision+1,updated_at=?
    WHERE run_id=? AND status='claimed' AND revision=? AND lease_owner=?
      AND stop_requested=0 AND calls_used<=max_rounds*2`)
    .bind(nextStatus,nextRole,nextRound,plan,artifact,JSON.stringify(history),
      done?null:1,now,claimed.run_id,claimed.revision,claimed.lease_owner).run();
  if(rowChanged(r))return {status:nextStatus,round:nextRound,calls_used:claimed.calls_used};
  // STOP may have arrived while inference was in-flight. Discard this model response.
  const stopped=await db.prepare(`UPDATE relay_loop_jobs SET
    status='stopped',next_role=NULL,active_slot=NULL,lease_owner=NULL,lease_expires_at=NULL,
    revision=revision+1,updated_at=?
    WHERE run_id=? AND status='claimed' AND revision=? AND lease_owner=? AND stop_requested=1`)
    .bind(now,claimed.run_id,claimed.revision,claimed.lease_owner).run();
  return {status:rowChanged(stopped)?'stopped':'unknown'};
}

export async function failLoopClaim(db, claimed, errorCode='MODEL_ERROR', now=Date.now()) {
  dbRequired(db);
  const reason=['MODEL_ERROR','INVALID_MODEL_OUTPUT'].includes(errorCode)?errorCode:'MODEL_ERROR';
  const r=await db.prepare(`UPDATE relay_loop_jobs SET
    status=CASE WHEN stop_requested=1 THEN 'stopped' ELSE 'failed' END,
    next_role=NULL,active_slot=NULL,lease_owner=NULL,lease_expires_at=NULL,
    revision=revision+1,updated_at=?,last_error_code=?
    WHERE run_id=? AND status='claimed' AND revision=? AND lease_owner=?`)
    .bind(now,reason,claimed.run_id,claimed.revision,claimed.lease_owner).run();
  return rowChanged(r);
}
