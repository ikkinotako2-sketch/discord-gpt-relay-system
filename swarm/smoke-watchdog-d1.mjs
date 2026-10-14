// Independent read-only Discord D1 snapshot. Query REST verb is POST but SQL is SELECT only.
// Requires its own D1 Read token; no D1 binding, insert, update, or migration.
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
import {RestoreBlocked} from './smoke-restore-executor.mjs';

export const DISCORD_D1_URL='https://api.cloudflare.com/client/v4/accounts/'+
 DISCORD_SMOKE_TARGET.accountId+'/d1/database/'+DISCORD_SMOKE_TARGET.databaseId+'/query';
export const JOB_QUERIES=Object.freeze({
 legacy:"SELECT COUNT(*) AS active_jobs FROM relay_loop_jobs WHERE active_slot=1 OR status IN ('queued','claimed')",
 swarm:"SELECT COALESCE(SUM(CASE WHEN active_slot=1 OR status IN ('queued','claimed','quota_wait') THEN 1 ELSE 0 END),0) AS active_jobs, COALESCE(SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END),0) AS unknown_jobs, COALESCE(SUM(CASE WHEN stop_requested=1 AND active_slot=1 THEN 1 ELSE 0 END),0) AS pending_stop FROM swarm_jobs"
});
const safeInt=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;

function parseResult(body,table){
 if(body?.success!==true||!Array.isArray(body.result)||body.result.length!==1)
  throw new RestoreBlocked('D1_'+table+'_RESULT_UNVERIFIED');
 const result=body.result[0];
 if(result?.success!==true||!Array.isArray(result.results)||result.results.length!==1)
  throw new RestoreBlocked('D1_'+table+'_ROWS_UNVERIFIED');
 const row=result.results[0];
 if(!safeInt(row.active_jobs))throw new RestoreBlocked('D1_'+table+'_ACTIVE_UNKNOWN');
 if(table==='swarm'&&(!safeInt(row.unknown_jobs)||!safeInt(row.pending_stop)))
  throw new RestoreBlocked('D1_SWARM_UNCERTAIN_COUNTS');
 return row;
}
export function createDiscordD1ReadClient({token,fetchImpl=fetch}={}){
 if(typeof token!=='string'||token.length<8||typeof fetchImpl!=='function')
  throw new RestoreBlocked('MISSING_D1_READ_CLIENT');
 async function count(kind){
  if(!Object.hasOwn(JOB_QUERIES,kind))throw new RestoreBlocked('INVALID_D1_TABLE');
  let response,body;
  try{
   response=await fetchImpl(DISCORD_D1_URL,{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({sql:JOB_QUERIES[kind]}),
    signal:AbortSignal.timeout(12000)
   });
   body=await response.json();
  }catch{throw new RestoreBlocked('D1_'+kind+'_READ_UNCERTAIN');}
  if(!response.ok)throw new RestoreBlocked('D1_'+kind+'_HTTP_ERROR');
  return parseResult(body,kind);
 }
 return {
  async snapshot(){
   // Sequential reads: no claim of a single database transaction or lock.
   const legacy=await count('legacy');
   const swarm=await count('swarm');
   return {
    legacyActive:legacy.active_jobs,swarmActive:swarm.active_jobs,
    unknownJobs:swarm.unknown_jobs,pendingStop:swarm.pending_stop,
    terminal:legacy.active_jobs===0&&swarm.active_jobs===0,
    // UNKNOWN is terminal for retry prevention, but not proven completed.
    clean:legacy.active_jobs===0&&swarm.active_jobs===0&&swarm.unknown_jobs===0&&swarm.pending_stop===0
   };
  }
 };
}
