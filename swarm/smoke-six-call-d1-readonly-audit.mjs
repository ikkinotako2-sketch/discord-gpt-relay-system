// Cloudflare D1 REST transport sends POST containing a FIXED SQL SELECT ONLY.
// OFFLINE-STAGED; not connected to production. No schema apply, D1 mutation,
// model invocation, deployment, credentials logging, or safe-to-launch decision.
import {DISCORD_D1_URL} from './smoke-watchdog-d1.mjs';

const REQUIRED=Object.freeze({
 swarm_smoke_control_runs:'table',
 swarm_smoke_control_claims:'table',
 swarm_smoke_control_one_open:'index',
 swarm_smoke_control_one_pending_or_open:'index',
 swarm_smoke_control_claim_atomic:'trigger',
 swarm_smoke_control_settle_atomic:'trigger'
});
export const D1_CONTROL_SCHEMA_NAMES=Object.freeze(Object.keys(REQUIRED));
export const D1_SCHEMA_SELECT=`SELECT name,type FROM sqlite_master
 WHERE name IN ('swarm_smoke_control_runs','swarm_smoke_control_claims',
 'swarm_smoke_control_one_open','swarm_smoke_control_one_pending_or_open',
 'swarm_smoke_control_claim_atomic','swarm_smoke_control_settle_atomic')
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
  FROM swarm_smoke_control_claims) AS final_receipts`;
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
   const rows=await select(D1_STATE_SELECT);
   if(rows.length!==1||!rows[0]||typeof rows[0]!=='object')
    return deny('CONTROL_STATE_ROWS_UNVERIFIED');
   const x=rows[0],keys=[
    'runs','reserved_attempts','verified_finals','open_runs','stopped_runs',
    'in_flight_runs','claim_rows','claimed_unresolved','new_unknown','final_receipts'
   ];
   if(!keys.every(k=>count(x[k]))||x.reserved_attempts<x.verified_finals||
      x.reserved_attempts>6*x.runs||x.verified_finals>6*x.runs||
      x.claim_rows!==x.reserved_attempts||
      x.claimed_unresolved+x.new_unknown+x.final_receipts!==x.claim_rows||
      x.verified_finals!==x.final_receipts||
      x.in_flight_runs!==x.claimed_unresolved||
      x.open_runs>x.runs||x.stopped_runs>x.runs)
    return deny('D1_CONTROL_COUNTERS_INCONSISTENT');
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
   counts,sqlDefinitionsVerified:false,
   originalHistoricalUnknownVerified:false,
   cloudflareAccountWideNeuronsVerified:false,
   note:'Schema-name and count read only, not atomic, not an approval to migrate, deploy or infer.'});
 }catch{return deny('D1_READ_INCOMPLETE_OR_UNAVAILABLE');}
}
