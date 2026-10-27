// Cloudflare D1 REST transport sends POST containing a FIXED SQL SELECT ONLY.
// OFFLINE-STAGED; not connected to production. No schema apply, D1 mutation,
// model invocation, deployment, credentials logging, or safe-to-launch decision.
import {DISCORD_D1_URL} from './smoke-watchdog-d1.mjs';
import {attestSixCallD1SqlDefinitions} from './smoke-six-call-d1-ddl-digest.mjs';

const REQUIRED=Object.freeze({
 swarm_smoke_control_runs:'table',
 swarm_smoke_control_claims:'table',
 swarm_smoke_control_one_open:'index',
 swarm_smoke_control_one_pending_or_open:'index',
 swarm_smoke_control_claim_atomic:'trigger',
 swarm_smoke_control_settle_atomic:'trigger',
 swarm_smoke_control_outputs:'table',
 swarm_smoke_control_owner_tasks:'table',
 swarm_smoke_control_owner_task_scope:'trigger',
 swarm_smoke_control_owner_task_no_update:'trigger',
 swarm_smoke_control_owner_task_no_delete:'trigger'
});
export const D1_CONTROL_SCHEMA_NAMES=Object.freeze(Object.keys(REQUIRED));
export const D1_SCHEMA_SELECT=`SELECT name,type,sql FROM sqlite_master
 WHERE name IN ('swarm_smoke_control_runs','swarm_smoke_control_claims',
 'swarm_smoke_control_one_open','swarm_smoke_control_one_pending_or_open',
 'swarm_smoke_control_claim_atomic','swarm_smoke_control_settle_atomic',
 'swarm_smoke_control_outputs','swarm_smoke_control_owner_tasks',
 'swarm_smoke_control_owner_task_scope',
 'swarm_smoke_control_owner_task_no_update',
 'swarm_smoke_control_owner_task_no_delete')
 ORDER BY name`;
export const D1_STATE_SELECT=`SELECT
 (SELECT COUNT(*) FROM swarm_smoke_control_runs) AS runs,
 (SELECT COALESCE(SUM(attempts),0) FROM swarm_smoke_control_runs) AS reserved_attempts,
 (SELECT COALESCE(SUM(completed),0) FROM swarm_smoke_control_runs) AS verified_finals,
 (SELECT COALESCE(SUM(CASE WHEN phase IN ('PENDING','ACTIVE','RESTORE_REQUIRED') THEN 1 ELSE 0 END),0)
  FROM swarm_smoke_control_runs) AS open_runs,
 (SELECT COALESCE(SUM(CASE WHEN stop_requested=1 THEN 1 ELSE 0 END),0)
  FROM swarm_smoke_control_runs) AS stopped_runs,
 (SELECT COALESCE(SUM(CASE WHEN in_flight_index IS NOT NULL THEN 1 ELSE 0 END),0)
  FROM swarm_smoke_control_runs) AS in_flight_runs,
 (SELECT COUNT(*) FROM swarm_smoke_control_claims) AS claim_rows,
 (SELECT COALESCE(SUM(CASE WHEN state='CLAIMED' THEN 1 ELSE 0 END),0)
  FROM swarm_smoke_control_claims) AS claimed_unresolved,
 (SELECT COALESCE(SUM(CASE WHEN state='UNKNOWN' THEN 1 ELSE 0 END),0)
  FROM swarm_smoke_control_claims) AS new_unknown,
 (SELECT COALESCE(SUM(CASE WHEN state='FINAL_VERIFIED' THEN 1 ELSE 0 END),0)
  FROM swarm_smoke_control_claims) AS final_receipts,
 (SELECT COUNT(*) FROM swarm_smoke_control_outputs) AS output_rows,
 (SELECT COUNT(*) FROM swarm_smoke_control_outputs o
  JOIN swarm_smoke_control_claims c
   ON c.run_id=o.run_id AND c.stage_index=o.stage_index
  WHERE c.state='FINAL_VERIFIED') AS final_output_rows,
 (SELECT COUNT(*) FROM swarm_smoke_control_outputs o
  LEFT JOIN swarm_smoke_control_claims c
   ON c.run_id=o.run_id AND c.stage_index=o.stage_index
  LEFT JOIN swarm_smoke_control_runs r ON r.run_id=o.run_id
  WHERE c.run_id IS NULL OR r.run_id IS NULL OR c.state='UNKNOWN'
   OR o.owner_id<>c.owner_id OR o.owner_id<>r.owner_id
   OR o.task_receipt_id<>r.task_receipt_id
   OR o.claim_revision<>(2*o.stage_index+1)
   OR o.saved_at_ms<c.claimed_at_ms
   OR o.saved_at_ms<r.created_at_ms OR o.saved_at_ms>=r.expires_at_ms
   OR o.receipt_id<>('final_'||substr(o.digest_sha256,1,40))) AS invalid_output_rows,
 (SELECT COUNT(*) FROM swarm_smoke_control_owner_tasks) AS owner_task_rows,
 (SELECT COUNT(*) FROM swarm_smoke_control_owner_tasks t
  LEFT JOIN swarm_smoke_control_runs r ON r.run_id=t.run_id
  WHERE r.run_id IS NULL OR r.owner_id<>t.owner_id
   OR r.task_receipt_id<>t.task_receipt_id
   OR t.created_at_ms<r.created_at_ms
   OR t.created_at_ms>=r.expires_at_ms) AS invalid_owner_task_rows,
 (SELECT COUNT(*) FROM swarm_smoke_control_runs r
  LEFT JOIN swarm_smoke_control_owner_tasks t ON t.run_id=r.run_id
  WHERE (r.phase IN ('ACTIVE','RESTORE_REQUIRED') OR r.attempts>0)
   AND t.run_id IS NULL) AS missing_owner_task_runs`;
// One new owner task, at most six durable outputs. Text is read solely to
// verify the stored digest, never returned, logged, or used as release proof.
// LIMIT 7 detects a seventh row; larger/historical output sets fail closed.
export const D1_OUTPUT_DIGEST_SELECT=`SELECT run_id,stage_index,owner_id,
 task_receipt_id,claim_revision,digest_sha256,receipt_id,final_text,saved_at_ms
 FROM swarm_smoke_control_outputs ORDER BY run_id,stage_index LIMIT 7`;
const utf8=new TextEncoder();
const DIGEST=/^[0-9a-f]{64}$/;
const RUN_ID=/^[A-Za-z0-9_-]{8,100}$/;
const OWNER_ID=/^[0-9]{15,22}$/;
async function sha256(text){
 const bytes=await crypto.subtle.digest('SHA-256',utf8.encode(text));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyBoundedOutputs(select,expected){
 if(expected===0)return true;
 if(expected>6)return false;
 const rows=await select(D1_OUTPUT_DIGEST_SELECT);
 if(rows.length!==expected)return false;
 const seen=new Set();
 for(const r of rows){
  if(!r||!RUN_ID.test(r.run_id||'')||
     !Number.isSafeInteger(r.stage_index)||r.stage_index<0||r.stage_index>5||
     !OWNER_ID.test(r.owner_id||'')||!RUN_ID.test(r.task_receipt_id||'')||
     !Number.isSafeInteger(r.claim_revision)||r.claim_revision!==2*r.stage_index+1||
     !DIGEST.test(r.digest_sha256||'')||
     r.receipt_id!=='final_'+r.digest_sha256.slice(0,40)||
     typeof r.final_text!=='string'||!r.final_text.trim()||
     r.final_text.length>2200||utf8.encode(r.final_text).byteLength>2400||
     !Number.isSafeInteger(r.saved_at_ms)||r.saved_at_ms<1e12)
   return false;
  const key=r.run_id+'|'+r.stage_index;
  if(seen.has(key))return false;
  seen.add(key);
  if(await sha256(r.final_text)!==r.digest_sha256)return false;
 }
 return true;
}
const count=n=>Number.isSafeInteger(n)&&n>=0;
const time=n=>Number.isSafeInteger(n)&&n>=1e12;
const deny=reason=>Object.freeze({status:'BLOCKED',reason,authorizesLiveActions:false,
 authorizesD1Writes:false,authorizesInference:false,authorizesDeployment:false});
const response=(status,more)=>Object.freeze({status,readOnly:true,
 source:'CLOUDFLARE_D1_SELECT_ONLY',...more,
 authorizesLiveActions:false,authorizesD1Writes:false,authorizesInference:false,
 authorizesDeployment:false});
/** A distinct D1 Read token is required. A valid token proves only read access.
 * These counts are not a transaction with the separate Discord/Watchdog reads.
 */
export async function collectSixCallD1ReadOnly({
 d1ReadToken,fetchImpl=fetch,clock=Date.now
}={}){
 if(typeof d1ReadToken!=='string'||d1ReadToken.length<8||
    typeof fetchImpl!=='function'||typeof clock!=='function')
  return deny('D1_READ_SCOPE_OR_CLIENT_MISSING');
 let start;
 try{start=clock();}catch{return deny('CLOCK_UNVERIFIED');}
 if(!time(start))return deny('CLOCK_UNVERIFIED');
 async function select(sql){
  let http,body;
  try{
   http=await fetchImpl(DISCORD_D1_URL,{
    method:'POST',headers:{Authorization:'Bearer '+d1ReadToken,
     'Content-Type':'application/json'},
    body:JSON.stringify({sql}),signal:AbortSignal.timeout(12000)
   });
   if(http?.status!==200||http?.ok!==true)throw Error('HTTP_ERROR');
   body=await http.json();
  }catch{throw Error('SELECT_HTTP_UNVERIFIED');}
  if(body?.success!==true||!Array.isArray(body.result)||body.result.length!==1||
     body.result[0]?.success!==true||!Array.isArray(body.result[0]?.results))
   throw Error('SELECT_RESULT_UNVERIFIED');
  return body.result[0].results;
 }
 try{
  const names=await select(D1_SCHEMA_SELECT);
  const seen=new Set();
  for(const entry of names){
   if(!entry||!Object.hasOwn(REQUIRED,entry.name)||seen.has(entry.name)||
      entry.type!==REQUIRED[entry.name])
    return deny('CONTROL_SCHEMA_NAMES_OR_TYPES_AMBIGUOUS');
   seen.add(entry.name);
  }
  let status,counts=null;
  if(seen.size===0)status='MIGRATION_UNAPPLIED_CONFIRMED';
  else if(seen.size!==D1_CONTROL_SCHEMA_NAMES.length)
   return deny('PARTIAL_D1_CONTROL_MIGRATION_UNSAFE');
  else{
   if(!(await attestSixCallD1SqlDefinitions(names)))
    return deny('D1_SQLITE_CONTROL_DDL_MISMATCH_OR_UNPINNED');
   const rows=await select(D1_STATE_SELECT);
   if(rows.length!==1||!rows[0]||typeof rows[0]!=='object')
    return deny('CONTROL_STATE_ROWS_UNVERIFIED');
   const x=rows[0],keys=[
    'runs','reserved_attempts','verified_finals','open_runs','stopped_runs',
    'in_flight_runs','claim_rows','claimed_unresolved','new_unknown','final_receipts',
    'output_rows','final_output_rows','invalid_output_rows',
    'owner_task_rows','invalid_owner_task_rows','missing_owner_task_runs'
   ];
   if(!keys.every(k=>count(x[k]))||x.reserved_attempts<x.verified_finals||
      x.reserved_attempts>6*x.runs||x.verified_finals>6*x.runs||
      x.claim_rows!==x.reserved_attempts||
      x.claimed_unresolved+x.new_unknown+x.final_receipts!==x.claim_rows||
      x.verified_finals!==x.final_receipts||
      x.final_output_rows!==x.final_receipts||
      x.output_rows<x.final_output_rows||
      x.output_rows>x.final_output_rows+x.claimed_unresolved||
      x.output_rows>x.claim_rows||x.invalid_output_rows!==0||
      x.owner_task_rows>x.runs||x.invalid_owner_task_rows!==0||
      x.missing_owner_task_runs!==0||
      x.in_flight_runs!==x.claimed_unresolved||
      x.open_runs>x.runs||x.stopped_runs>x.runs)
    return deny('D1_CONTROL_COUNTERS_INCONSISTENT');
   // Aggregate counts cannot establish that final_text actually hashes to
   // digest_sha256. Re-read the bounded content and hash locally; no text
   // is exposed in the returned attestation. Reads are non-atomic, so this
   // still cannot authorize production inference or D1 writes.
   if(!(await verifyBoundedOutputs(select,x.output_rows)))
    return deny('D1_OUTPUT_CONTENT_DIGEST_OR_READBACK_UNVERIFIED');
   // Existing SQL object names alone do NOT attest the actual trigger bodies.
   // Even a perfectly empty/stable migration is still NOT live authorization.
   status=x.open_runs===0&&x.in_flight_runs===0&&x.new_unknown===0?
    'MIGRATION_OBJECTS_PRESENT_REVIEW_REQUIRED':'CONTROL_JOBS_REQUIRE_MANUAL_REVIEW';
   counts=Object.freeze(Object.fromEntries(keys.map(k=>[k,x[k]])));
  }
  let end;
  try{end=clock();}catch{return deny('CLOCK_UNVERIFIED');}
  if(!time(end)||end<start||end-start>5*60*1000)
   return deny('D1_EVIDENCE_STALE_OR_CLOCK_ROLLBACK');
  return response(status,{checkedAtMs:end,schemaObjectCount:seen.size,
   expectedObjectCount:D1_CONTROL_SCHEMA_NAMES.length,
   counts,sqlDefinitionsVerified:seen.size===D1_CONTROL_SCHEMA_NAMES.length,
   originalHistoricalUnknownVerified:false,
   cloudflareAccountWideNeuronsVerified:false,
   note:'Pinned SQL definition hash, counts and bounded output content digests reviewed non-atomically. Not proof of a deployed recovery or authorization to migrate, deploy or infer.'});
 }catch{return deny('D1_READ_INCOMPLETE_OR_UNAVAILABLE');}
}
