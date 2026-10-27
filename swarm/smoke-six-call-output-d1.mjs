// OFFLINE-STAGED D1 output artifact persister for six-call controller.
// Not imported by any live Worker. REVIEW SQL is NOT applied to production.
// Exactly one claim-bound output INSERT, then SELECT readback. No retry.
// Any ambiguous D1 response AFTER an inference must settle as UNKNOWN.
const ID=/^[A-Za-z0-9_-]{8,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const OWNER=/^\d{15,22}$/;
const okMs=n=>Number.isSafeInteger(n)&&n>=1e12;
const utf8=new TextEncoder();
const SAVE_SQL=`
INSERT INTO swarm_smoke_control_outputs(
 run_id,stage_index,owner_id,task_receipt_id,claim_revision,
 digest_sha256,receipt_id,final_text,saved_at_ms
)
SELECT r.run_id,c.stage_index,r.owner_id,r.task_receipt_id,?,
 ?,?,?,?
FROM swarm_smoke_control_runs r
JOIN swarm_smoke_control_claims c ON c.run_id=r.run_id
WHERE r.run_id=? AND r.owner_id=? AND r.task_receipt_id=?
 AND r.revision=? AND r.phase='ACTIVE' AND r.stop_requested=0
 AND r.in_flight_index=? AND r.attempts=? AND r.completed=?
 AND c.stage_index=? AND c.state='CLAIMED'
 AND c.owner_id=r.owner_id AND c.claimed_at_ms<=?
 AND ?>=r.created_at_ms AND ?<r.expires_at_ms
RETURNING run_id,stage_index
`;
const READ_SQL=`
SELECT run_id,stage_index,owner_id,task_receipt_id,
 claim_revision,digest_sha256,receipt_id,final_text,saved_at_ms
FROM swarm_smoke_control_outputs
WHERE run_id=? AND stage_index=?
LIMIT 1
`;
const LAST_OUTPUT_SQL=`
SELECT o.final_text AS final_text
FROM swarm_smoke_control_outputs o
JOIN swarm_smoke_control_claims c ON c.run_id=o.run_id
 AND c.stage_index=o.stage_index
WHERE o.run_id=? AND o.stage_index=? AND c.state='FINAL_VERIFIED'
LIMIT 1
`;
async function hash(s){
 const raw=await crypto.subtle.digest('SHA-256',utf8.encode(s));
 return Array.from(new Uint8Array(raw),b=>b.toString(16).padStart(2,'0')).join('');
}
export function createStagedD1SixCallOutputStore({db,runId,ownerId,clock=Date.now}={}){
 if(typeof db?.prepare!=='function'||!ID.test(runId||'')||
    !OWNER.test(ownerId||'')||typeof clock!=='function')
  throw Error('STAGED_OUTPUT_STORE_DEPENDENCIES_UNVERIFIED');
 return Object.freeze({
  async persistVerifiedOutput(data){
   const {taskReceiptId,stageIndex,claimRevision,digest,receiptId,text}=data||{};
   if(data?.runId!==runId||!ID.test(taskReceiptId||'')||
      !Number.isSafeInteger(stageIndex)||stageIndex<0||stageIndex>5||
      !Number.isSafeInteger(claimRevision)||claimRevision<1||
      !HASH.test(digest||'')||receiptId!=='final_'+digest.slice(0,40)||
      typeof text!=='string'||!text.trim()||text.length>2200||
      utf8.encode(text).byteLength>2400)
    throw Error('OUTPUT_RECEIPT_SCOPE_INVALID');
   if(await hash(text)!==digest)
    throw Error('OUTPUT_CONTENT_DIGEST_MISMATCH');
   let now;try{now=clock();}catch{throw Error('OUTPUT_CLOCK_UNVERIFIED');}
   if(!okMs(now))throw Error('OUTPUT_CLOCK_UNVERIFIED');
   // Insert once using the current atomic claim revision and STOP gate.
   // A failed INSERT may have succeeded remotely: NEVER retry.
   const inserted=await db.prepare(SAVE_SQL).bind(
    claimRevision,digest,receiptId,text,now,
    runId,ownerId,taskReceiptId,
    claimRevision,stageIndex,stageIndex+1,stageIndex,
    stageIndex,now,now,now
   ).first();
   if(inserted?.run_id!==runId||inserted.stage_index!==stageIndex)
    throw Error('OUTPUT_INSERT_UNVERIFIED_NO_RETRY');
   const saved=await db.prepare(READ_SQL).bind(runId,stageIndex).first();
   if(!saved||saved.run_id!==runId||saved.stage_index!==stageIndex||
      saved.owner_id!==ownerId||saved.task_receipt_id!==taskReceiptId||
      saved.claim_revision!==claimRevision||saved.digest_sha256!==digest||
      saved.receipt_id!==receiptId||saved.final_text!==text||
      saved.saved_at_ms!==now)
    throw Error('OUTPUT_READBACK_UNVERIFIED_NO_RETRY');
   return Object.freeze({
    saved:true,runId,taskReceiptId,stageIndex,claimRevision,digest,receiptId
   });
  },
  async getLastConfirmedOutput({stageIndex}={}){
   if(!Number.isSafeInteger(stageIndex)||stageIndex<0||stageIndex>=6)
    throw Error('INVALID_PRIOR_STAGE');
   if(stageIndex===0)return '';
   const row=await db.prepare(LAST_OUTPUT_SQL).bind(runId,stageIndex-1).first();
   if(typeof row?.final_text!=='string'||!row.final_text.trim()||
      row.final_text.length>2200)
    throw Error('CONFIRMED_PRIOR_OUTPUT_MISSING');
   return row.final_text.slice(0,1000);
  }
 });
}
