// STAGED ONLY: derive the provider's original owner task from persisted D1.
// This is not a production route and makes no network or provider calls.
// A separately reviewed owner OAuth/CSRF handler must create this immutable
// task row while a PENDING run exists. Never trust HTTP JSON as this input.
// A trusted external historical UNKNOWN verifier is REQUIRED rather than
// treating a caller's "true" property as evidence.
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
import {HISTORICAL_UNKNOWN_FINGERPRINT} from './smoke-reviewed-unknown-safe-off.mjs';
const ID=/^[A-Za-z0-9_-]{8,100}$/;
const OWNER=/^[0-9]{15,22}$/;
const MS=t=>Number.isSafeInteger(t)&&t>=1e12;
const SHA=/^[a-f0-9]{64}$/;
const utf8=new TextEncoder();
const LOAD= `
SELECT r.run_id, r.owner_id, r.task_receipt_id,
 r.account_id,r.worker_name,r.database_id,r.phase,r.revision,
 r.attempts,r.completed,r.stop_requested,r.in_flight_index,
 r.created_at_ms,r.expires_at_ms,
 t.original_task,t.created_at_ms AS task_created_at_ms,
 c.stage_index,c.state AS claim_state,c.owner_id AS claim_owner_id
FROM swarm_smoke_control_runs r
JOIN swarm_smoke_control_owner_tasks t ON t.run_id=r.run_id
JOIN swarm_smoke_control_claims c ON c.run_id=r.run_id
WHERE r.run_id=? AND r.task_receipt_id=? AND r.owner_id=?
 AND c.stage_index=?
LIMIT 1
`;
// Review-only, never build the original pin from the same live D1 SELECT.
// It must come from a separately retained, owner-reviewed original-row read.
// The real pin is NOT present in this repository, so the default fails closed.
// Including all stored columns detects row replacement and equal-length edits.
const HISTORICAL_UNKNOWN_COLUMNS=Object.freeze([
 'run_id','owner_id','task','cycles','status','calls_used','revision',
 'history_json','checkpoint','stop_requested','active_slot','lease_owner',
 'lease_expires_at','last_error','created_at','updated_at','expires_at'
]);
const HISTORICAL_UNKNOWN_SQL=`SELECT ${HISTORICAL_UNKNOWN_COLUMNS.join(',')},
 LENGTH(history_json) AS history_length,LENGTH(checkpoint) AS checkpoint_length
 FROM swarm_jobs WHERE status='unknown' AND LENGTH(history_json)<=65536
 AND LENGTH(checkpoint)<=65536 AND LENGTH(task)<=4096 LIMIT 2`;
function validIndependentPin(pin){
 return pin&&Object.keys(pin).sort().join(',')==='digestSha256,ownerId,runId'&&
  ID.test(pin.runId||'')&&OWNER.test(pin.ownerId||'')&&
  SHA.test(pin.digestSha256||'');
}
async function verifyPreservedUnknownInD1(db,now,pin){
 const evidence=await db.prepare(HISTORICAL_UNKNOWN_SQL).all();
 const rows=evidence?.results;
 const row=rows?.[0];
 if(!Array.isArray(rows)||rows.length!==1||!row||
    row.run_id!==pin.runId||row.owner_id!==pin.ownerId||
    !Object.entries(HISTORICAL_UNKNOWN_FINGERPRINT)
     .every(([key,value])=>row[key]===value)||
    now<HISTORICAL_UNKNOWN_FINGERPRINT.updated_at||
    await sha256(JSON.stringify(HISTORICAL_UNKNOWN_COLUMNS.map(key=>row[key])))!==
      pin.digestSha256)
   throw Error('HISTORICAL_UNKNOWN_D1_FINGERPRINT_CHANGED_OR_MISSING');
}
const PREVIOUS=`
SELECT o.final_text,o.digest_sha256,o.owner_id,o.task_receipt_id,
 o.claim_revision,o.receipt_id,c.state AS claim_state
FROM swarm_smoke_control_outputs o
JOIN swarm_smoke_control_claims c ON
 c.run_id=o.run_id AND c.stage_index=o.stage_index
WHERE o.run_id=? AND o.stage_index=?
LIMIT 1
`;
async function sha256(s){
 const hash=await crypto.subtle.digest('SHA-256',utf8.encode(s));
 return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
function exactRequest(x,runId){
 return x&&Object.keys(x).sort().join(',')===
   'claimRevision,runId,stageIndex,taskReceiptId'&&
   x.runId===runId&&ID.test(x.taskReceiptId||'')&&
   Number.isSafeInteger(x.stageIndex)&&x.stageIndex>=0&&x.stageIndex<6&&
   Number.isSafeInteger(x.claimRevision)&&x.claimRevision>=1;
}
/**
 * Read the pinned original UNKNOWN directly from the same D1 binding as the
 * owner task; a status string from any caller or external mock is not proof.
 * Even a positive local D1 read DOES NOT authorize live deployment or AI.
 */
export function createStagedD1OwnerTaskReader({
 db,runId,ownerId,independentlyPinnedUnknown,clock=Date.now
}={}){
 if(typeof db?.prepare!=='function'||!ID.test(runId||'')||
    !OWNER.test(ownerId||'')||!validIndependentPin(independentlyPinnedUnknown)||
    typeof clock!=='function')
   throw Error('TRUSTED_OWNER_TASK_DEPENDENCIES_MISSING');
 return Object.freeze({
  async loadVerifiedTask(request){
   if(!exactRequest(request,runId))
     throw Error('OWNER_TASK_CLAIM_INPUT_INVALID');
   const now=clock();
   if(!MS(now))throw Error('OWNER_TASK_CLOCK_INVALID');
   const r=await db.prepare(LOAD).bind(
     runId,request.taskReceiptId,ownerId,request.stageIndex).first();
   const i=request.stageIndex;
   if(!r||r.run_id!==runId||r.owner_id!==ownerId||
      r.task_receipt_id!==request.taskReceiptId||
      r.account_id!==DISCORD_SMOKE_TARGET.accountId||
      r.worker_name!==DISCORD_SMOKE_TARGET.worker||
      r.database_id!==DISCORD_SMOKE_TARGET.databaseId||
      r.phase!=='ACTIVE'||r.stop_requested!==0||
      r.in_flight_index!==i||r.revision!==request.claimRevision||
      r.attempts!==i+1||r.completed!==i||
      r.stage_index!==i||r.claim_state!=='CLAIMED'||
      r.claim_owner_id!==ownerId||
      !MS(r.created_at_ms)||!MS(r.expires_at_ms)||
      r.expires_at_ms<=now||r.expires_at_ms-r.created_at_ms>20*60*1000||
      !MS(r.task_created_at_ms)||r.task_created_at_ms>now||
      typeof r.original_task!=='string'||!r.original_task.trim()||
      r.original_task.length>1000)
     throw Error('OWNER_TASK_D1_CLAIM_OR_STATE_UNVERIFIED');
   // Fail closed if the original historical UNKNOWN was removed, edited,
   // duplicated or became unreadable. Never replay or mutate it.
   await verifyPreservedUnknownInD1(db,now,independentlyPinnedUnknown);
   let previous='';
   if(i>0){
    const p=await db.prepare(PREVIOUS).bind(runId,i-1).first();
    if(!p||p.claim_state!=='FINAL_VERIFIED'||
       p.owner_id!==ownerId||p.task_receipt_id!==request.taskReceiptId||
       !Number.isSafeInteger(p.claim_revision)||p.claim_revision<1||
       !SHA.test(p.digest_sha256||'')||
       p.receipt_id!=='final_'+p.digest_sha256.slice(0,40)||
       typeof p.final_text!=='string'||!p.final_text.trim()||
       p.final_text.length>2200||
       utf8.encode(p.final_text).byteLength>2400||
       await sha256(p.final_text)!==p.digest_sha256)
      throw Error('PRIOR_FINAL_OUTPUT_UNVERIFIED');
    previous=p.final_text.slice(0,1000);
   }
   // If STOP lands while reading, the provider's post-claim check rechecks
   // D1 again before its own AI.run. External AI itself is nontransactional.
   const fresh=await db.prepare(LOAD).bind(
     runId,request.taskReceiptId,ownerId,i).first();
   if(!fresh||fresh.phase!=='ACTIVE'||fresh.stop_requested!==0||
      fresh.claim_state!=='CLAIMED'||fresh.revision!==request.claimRevision||
      fresh.in_flight_index!==i||fresh.attempts!==i+1||
      fresh.completed!==i||fresh.run_id!==r.run_id||
      fresh.owner_id!==r.owner_id||fresh.task_receipt_id!==r.task_receipt_id||
      fresh.account_id!==r.account_id||fresh.worker_name!==r.worker_name||
      fresh.database_id!==r.database_id||
      fresh.expires_at_ms!==r.expires_at_ms||
      fresh.original_task!==r.original_task||
      fresh.task_created_at_ms!==r.task_created_at_ms)
     throw Error('OWNER_STOP_OR_CLAIM_CHANGED_BEFORE_PROVIDER');
   // The original UNKNOWN must also remain identical after all intermediate
   // D1 reads. These are not atomic snapshots or a live-release grant.
   await verifyPreservedUnknownInD1(db,now,independentlyPinnedUnknown);
   return Object.freeze({
    ...request,source:'SERVER_D1_VERIFIED_OWNER_TASK',
    ownerId,expiryMs:r.expires_at_ms,checkedAtMs:now,
    previousStageFinalVerified:true,
    legacyHistoricalUnknownImmutable:true,
    originalTask:r.original_task,previousConfirmedOutput:previous
   });
  }
 });
}
