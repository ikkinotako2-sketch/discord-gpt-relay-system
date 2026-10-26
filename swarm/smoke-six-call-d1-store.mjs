// OFFLINE-STAGED D1 persistence adapter for the six-call controller.
// This module does not create/activate jobs, import the live Worker, perform
// migrations, hold credentials, deploy, or make a provider inference.
// Schema: smoke-six-call-d1-schema.review.sql (independent approval required).
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

const ID=/^[A-Za-z0-9_-]{8,100}$/;
const validMs=x=>Number.isSafeInteger(x)&&x>=1e12;
const dayUTC=x=>new Date(x).toISOString().slice(0,10);

// A single INSERT with an AFTER INSERT SQLite trigger performs BOTH the
// local-budget reservation and claim-counter CAS atomically, in D1.
// There is no SELECT-then-UPDATE window and no JavaScript multi-query tx.
export const CLAIM_SQL=`
INSERT INTO swarm_smoke_control_claims
 (run_id,stage_index,owner_id,utc_day,claimed_at_ms,state)
 SELECT r.run_id,r.attempts,r.owner_id,?,?,'CLAIMED'
 FROM swarm_smoke_control_runs AS r
 WHERE r.run_id=? AND r.revision=? AND r.attempts=?
   AND r.phase='ACTIVE' AND r.stop_requested=0 AND r.completed=r.attempts
   AND r.in_flight_index IS NULL AND r.attempts<6
   AND ?>=r.created_at_ms AND ?<r.expires_at_ms
   AND ?=6
 RETURNING run_id,stage_index
`;

// The AFTER UPDATE trigger settles counters and status in the same statement.
export const FINISH_SQL=`
UPDATE swarm_smoke_control_claims
 SET state=?,settled_at_ms=?
 WHERE run_id=? AND stage_index=? AND state='CLAIMED'
   AND ? >= claimed_at_ms
   AND EXISTS(
    SELECT 1 FROM swarm_smoke_control_runs AS r
     WHERE r.run_id=swarm_smoke_control_claims.run_id
      AND r.phase='ACTIVE' AND r.revision=?
      AND r.attempts=? AND r.in_flight_index=?
      AND r.completed=?)
 RETURNING run_id,stage_index
`;

const READ_SQL=`
SELECT run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,attempts,completed,revision,stop_requested,
 in_flight_index,created_at_ms,updated_at_ms,expires_at_ms
 FROM swarm_smoke_control_runs WHERE run_id=? LIMIT 1
`;

const VALID_PHASE=new Set(['PENDING','ACTIVE','RESTORE_REQUIRED','RESTORED','BLOCKED']);
function decode(row){
 if(!row)return null;
 if(!ID.test(row.run_id||'')||!ID.test(row.task_receipt_id||'')||
    !/^[0-9]{15,22}$/.test(row.owner_id||'')||
    !VALID_PHASE.has(row.phase)||!validMs(row.created_at_ms)||
    !validMs(row.expires_at_ms)||!validMs(row.updated_at_ms)||
    !Number.isSafeInteger(row.attempts)||!Number.isSafeInteger(row.completed)||
    !Number.isSafeInteger(row.revision)||
    row.revision<0||![0,1].includes(row.stop_requested)||row.attempts<0||row.attempts>6||
    row.completed<0||row.completed>row.attempts||
    (row.in_flight_index!==null&&
     (!Number.isSafeInteger(row.in_flight_index)||
      row.in_flight_index<0||row.in_flight_index>5)))
   throw Error('D1_CONTROL_ROW_INVALID');
 return {
  schema:'discord-six-call.v1',phase:row.phase,runId:row.run_id,
  taskReceiptId:row.task_receipt_id,baselineVersion:row.baseline_version,
  smokeVersion:row.smoke_version,
  target:{accountId:row.account_id,worker:row.worker_name,databaseId:row.database_id},
  createdAtMs:row.created_at_ms,expiresAtMs:row.expires_at_ms,
  attempts:row.attempts,completed:row.completed,revision:row.revision,
  stopRequested:row.stop_requested===1,
  inFlightIndex:row.in_flight_index,
  historicalUnknownPreserved:true,authorizesDeployment:false,
  authorizesInference:false
 };
}
function requireDb(db,runId){
 if(!db||typeof db.prepare!=='function'||!ID.test(runId||''))
  throw TypeError('DEDICATED_D1_OR_RUN_ID_INVALID');
}
export function createD1SixCallStore({db,runId}={}){
 requireDb(db,runId);
 const read=async()=>{
  const row=await db.prepare(READ_SQL).bind(runId).first();
  const decoded=decode(row);
  if(decoded&&(
      decoded.target.accountId!==DISCORD_SMOKE_TARGET.accountId||
      decoded.target.worker!==DISCORD_SMOKE_TARGET.worker||
      decoded.target.databaseId!==DISCORD_SMOKE_TARGET.databaseId
    ))throw Error('WRONG_D1_TARGET');
  return decoded;
 };
 // Owner-scoped emergency stop: one SQLite statement is the linearization
 // point. In-flight claims stay ACTIVE but become non-runnable; their original
 // CAS revision is preserved for one final settlement or terminal UNKNOWN.
 // An idle ACTIVE run goes directly to RESTORE_REQUIRED. PENDING cannot start.
 // No provider/Cloudflare action occurs here; restore is a separate gate.
 const STOP_SQL=`
 UPDATE swarm_smoke_control_runs
 SET stop_requested=1,
  phase=CASE WHEN phase='PENDING' THEN 'BLOCKED'
             WHEN in_flight_index IS NULL THEN 'RESTORE_REQUIRED'
             ELSE 'ACTIVE' END,
  revision=revision+CASE WHEN in_flight_index IS NULL THEN 1 ELSE 0 END,
  updated_at_ms=?
 WHERE run_id=? AND owner_id=? AND phase IN ('PENDING','ACTIVE')
  AND stop_requested=0 AND updated_at_ms<=?
 RETURNING run_id
 `;
 return Object.freeze({
  read,
  async requestStopOnce({runId:requested,ownerId,nowMs}={}){
   if(requested!==runId||!/^[0-9]{15,22}$/.test(ownerId||'')||!validMs(nowMs))
    throw Error('INVALID_OWNER_STOP_REQUEST');
   const changed=await db.prepare(STOP_SQL).bind(nowMs,runId,ownerId,nowMs).first();
   const state=await read();
   if(!state)return {status:'BLOCKED',reason:'SMOKE_RUN_NOT_FOUND'};
   if(!changed)return {status:'BLOCKED',reason:'STOP_NOT_AUTHORIZED_OR_STATE_UNVERIFIED'};
   if(changed.run_id!==runId||state.stopRequested!==true||
      !['ACTIVE','RESTORE_REQUIRED','BLOCKED'].includes(state.phase))
    throw Error('STOP_WRITE_UNVERIFIED');
   return {status:'STOP_RECORDED',phase:state.phase,
    pendingInFlight:state.inFlightIndex!==null,
    restoreRequired:state.phase==='RESTORE_REQUIRED'};
  },
  async claimOnce({runId:requested,expectedRevision,index,expectedExpiryMs,
    nowMs,localDailyCap}={}){
   if(requested!==runId||!validMs(nowMs)||
      !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
      !Number.isSafeInteger(index)||index<0||index>=6||
      !validMs(expectedExpiryMs)||localDailyCap!==6)
    throw Error('INVALID_ATOMIC_CLAIM_REQUEST');
   // An already used claim is NOT retried after any exception/timeout.
   const inserted=await db.prepare(CLAIM_SQL)
    .bind(dayUTC(nowMs),nowMs,runId,expectedRevision,index,
          nowMs,nowMs,localDailyCap).first();
   if(!inserted)return {claimed:false};
   if(inserted.run_id!==runId||inserted.stage_index!==index)
    throw Error('D1_INSERT_RECEIPT_INVALID');
   const state=await read();
   if(!state||state.stopRequested===true||state.revision!==expectedRevision+1||
      state.attempts!==index+1||state.completed!==index||
      state.inFlightIndex!==index||
      state.expiresAtMs!==expectedExpiryMs||
      state.phase!=='ACTIVE')
    throw Error('ATOMIC_CLAIM_STATE_UNVERIFIED');
   return {claimed:true,runId,index,revision:state.revision,
     attempts:state.attempts,completed:state.completed,
     inFlightIndex:state.inFlightIndex};
  },
  async finishOnce({runId:requested,index,expectedClaimRevision,
    outcome,nowMs}={}){
   if(requested!==runId||!validMs(nowMs)||
      !Number.isSafeInteger(index)||index<0||index>=6||
      !Number.isSafeInteger(expectedClaimRevision)||expectedClaimRevision<1||
      !['FINAL_VERIFIED','UNKNOWN'].includes(outcome))
    throw Error('INVALID_SETTLEMENT_REQUEST');
   const updated=await db.prepare(FINISH_SQL)
    .bind(outcome,nowMs,runId,index,nowMs,expectedClaimRevision,
          index+1,index,index).first();
   if(!updated||updated.run_id!==runId||updated.stage_index!==index)
    throw Error('SETTLEMENT_CAS_CONFLICT_OR_UNKNOWN');
   const state=await read();
   if(!state||state.revision!==expectedClaimRevision+1||
      state.attempts!==index+1||state.inFlightIndex!==null||
      state.completed!==(index+(outcome==='FINAL_VERIFIED'?1:0))||
      !['ACTIVE','RESTORE_REQUIRED'].includes(state.phase))
    throw Error('SETTLEMENT_STATE_UNVERIFIED');
   return {runId,revision:state.revision,attempts:state.attempts,
     completed:state.completed,inFlightIndex:state.inFlightIndex,
     phase:state.phase};
  }
 });
}
