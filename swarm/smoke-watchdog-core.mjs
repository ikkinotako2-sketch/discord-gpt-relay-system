// Staged independent watchdog for ONE explicitly approved Discord-only smoke.
// Never imported by the existing Discord Worker or GitHub release workflow.
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
import {createDiscordCloudflareClient,restoreDiscordSmoke,RestoreBlocked} from './smoke-restore-executor.mjs';
import {createDiscordD1ReadClient} from './smoke-watchdog-d1.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARM='EXPLICIT_DISCORD_SMOKE_RESTORE_ONCE';
const APPROVAL='RESTORE-DISCORD-SMOKE-BASELINE-ONCE';
// Prearm before traffic switch. The future deployment ID does not yet exist.
const PREARM='PREARM_TO_CAPTURE_SMOKE_DEPLOYMENT';
const NON_SECRET_FIELDS=Object.freeze([
 'WATCHDOG_ACCOUNT_ID','WATCHDOG_WORKER','WATCHDOG_D1_ID',
 'WATCHDOG_BASELINE_VERSION','WATCHDOG_SMOKE_VERSION',
 'WATCHDOG_EXPECTED_DEPLOYMENT_ID','WATCHDOG_EXPIRES_AT'
]);
function blocked(reason){return {status:'BLOCKED',reason};}
function validConfig(env,nowMs){
 if(env?.WATCHDOG_ARMED!==ARM || env?.WATCHDOG_APPROVAL!==APPROVAL)
  return blocked('NOT_ARMED');
 if(env.WATCHDOG_ACCOUNT_ID!==DISCORD_SMOKE_TARGET.accountId ||
    env.WATCHDOG_WORKER!==DISCORD_SMOKE_TARGET.worker ||
    env.WATCHDOG_D1_ID!==DISCORD_SMOKE_TARGET.databaseId)
  return blocked('TARGET_MISMATCH');
 const baselineVersion=env.WATCHDOG_BASELINE_VERSION,
  smokeVersion=env.WATCHDOG_SMOKE_VERSION,expectedDeploymentId=env.WATCHDOG_EXPECTED_DEPLOYMENT_ID;
 if(!UUID.test(baselineVersion||'')||!UUID.test(smokeVersion||'')||
    (!UUID.test(expectedDeploymentId||'')&&expectedDeploymentId!==PREARM)||
    baselineVersion===smokeVersion)return blocked('UNPINNED_VERSIONS');
 if(!/^\d{13}$/.test(String(env.WATCHDOG_EXPIRES_AT||'')) ||
    !Number.isSafeInteger(Number(env.WATCHDOG_EXPIRES_AT)) ||
    !Number.isSafeInteger(nowMs))
  return blocked('INVALID_DEADLINE');
 const expiryMs=Number(env.WATCHDOG_EXPIRES_AT);
 // No more than a bounded post-expiry recovery window: a weeks-old replay
 // could overwrite a newer deployment even if the old IDs were somehow reused.
 if(nowMs>expiryMs+20*60*1000)
  return blocked('WATCHDOG_RESTORE_WINDOW_STALE_MANUAL_RECOVERY');
 // Before the deadline no Cloudflare API requests, D1 queries, or latch writes.
 if(nowMs<expiryMs)return {status:'WAIT',expiresAt:expiryMs};
 if(typeof env.WATCHDOG_RESTORE_TOKEN!=='string'||env.WATCHDOG_RESTORE_TOKEN.length<8 ||
    typeof env.WATCHDOG_D1_READ_TOKEN!=='string'||env.WATCHDOG_D1_READ_TOKEN.length<8)
  return blocked('MISSING_SCOPED_CREDENTIALS');
 if(!env.WATCHDOG_ONCE?.idFromName||!env.WATCHDOG_ONCE?.get)
  return blocked('MISSING_DURABLE_ONE_SHOT_LATCH');
 return {status:'READY',baselineVersion,smokeVersion,expectedDeploymentId,expiryMs};
}
export async function inspectPostRestore(client,d1Reader,version){
 const active=await client.deployment();
 if(active.versionId!==version)return blocked('POST_RESTORE_LIVE_VERSION_CHANGED');
 // This reread validates version-associated remote bindings, NOT mutable binding overrides.
 const remote=await client.bindings(version);
 if(!Array.isArray(remote))return blocked('REMOTE_BINDINGS_UNVERIFIED');
 const d1=remote.filter(x=>x?.type==='d1');
 const loopDb=remote.filter(x=>x?.name==='LOOP_DB');
 if(d1.length!==1||loopDb.length!==1||loopDb[0]!==d1[0]||
    d1[0].database_id!==DISCORD_SMOKE_TARGET.databaseId)
  return blocked('POST_RESTORE_D1_MISMATCH');
 for(const k of FLAGS){
  const matches=remote.filter(x=>x?.name===k);
  if(matches.length>1 || (matches.length===1&&(matches[0].type!=='plain_text'||matches[0].text!=='false')))
   return blocked('POST_RESTORE_FLAG_UNVERIFIED_'+k);
 }
 let snapshot;
 try{snapshot=await d1Reader.snapshot();}
 catch{return blocked('POST_RESTORE_D1_READ_UNVERIFIED');}
 if(!snapshot.terminal)return blocked('POST_RESTORE_ACTIVE_JOBS_UNRESOLVED');
 if(!snapshot.clean)return blocked('POST_RESTORE_UNKNOWN_OR_STOP_UNVERIFIED');
 return {status:'OFF_VERIFIED',versionId:version,jobState:'ZERO_ACTIVE_AND_ZERO_UNKNOWN'};
}
/**
 * Injection parameters support purely offline HTTP mocks. Latch is an independent
 * Durable Object, never D1; its claim is persisted BEFORE any restore API POST.
 * Any outcome after claim, including timeout, is one-shot. No automatic retries.
 */
export async function runIndependentWatchdogTick(env,{
 nowMs=Date.now(),fetchImpl=fetch,
 claimOnce=null,clientFactory=createDiscordCloudflareClient,
 d1Factory=createDiscordD1ReadClient
}={}){
 const config=validConfig(env,nowMs);
 if(config.status!=='READY')return config;
 const {baselineVersion,smokeVersion,expectedDeploymentId,expiryMs}=config;
 const claim=claimOnce??(async()=>{
  const id=env.WATCHDOG_ONCE.idFromName('discord-smoke:'+smokeVersion+':'+String(expiryMs));
  const reply=await env.WATCHDOG_ONCE.get(id).fetch('https://watchdog.internal/claim',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({smokeVersion,expiryMs})
  });
  if(reply.status!==200)return false;
  const data=await reply.json();
  return data?.claimed===true;
 });
 // Do not leak tokens into HTTP responses, logs, or thrown errors.
 try{if(await claim()!==true)return blocked('ALREADY_ATTEMPTED_OR_LATCH_UNAVAILABLE');}
 catch{return blocked('ONE_SHOT_LATCH_UNAVAILABLE');}
 let client,d1Reader;
 try{
  client=clientFactory({token:env.WATCHDOG_RESTORE_TOKEN,fetchImpl});
  d1Reader=d1Factory({token:env.WATCHDOG_D1_READ_TOKEN,fetchImpl});
 }catch{return blocked('CLIENT_INITIALIZATION_FAILED');}
 // A read failure does not suppress emergency OFF restore after expiry.
 // But the final state can NEVER be marked fully verified without a fresh D1 read.
 let before=null;
 try{before=await d1Reader.snapshot();}catch{before=null;}
 try{
  // A prearmed alarm can exist BEFORE the smoke deployment ID is issued.
  // Capture that server-issued ID at recovery time, but ONLY for the two pinned
  // versions, never for an unrelated version or a traffic-split deployment.
  // restoreDiscordSmoke rereads the deployment both initially and immediately
  // before POST; any mismatch fails closed. Cloudflare has no atomic CAS.
  let confirmedDeploymentId=expectedDeploymentId;
  if(expectedDeploymentId===PREARM){
   const observed=await client.deployment();
   if(observed.versionId!==baselineVersion&&observed.versionId!==smokeVersion)
    return blocked('PREARM_UNKNOWN_LIVE_VERSION_NO_RESTORE');
   if(!UUID.test(observed.deploymentId||''))
    return blocked('PREARM_DEPLOYMENT_ID_UNVERIFIED');
   confirmedDeploymentId=observed.deploymentId;
  }
  const result=await restoreDiscordSmoke({client,baselineVersion,smokeVersion,
   expectedDeploymentId:confirmedDeploymentId,expiryMs,nowMs,execute:true,approval:APPROVAL});
  if(!['RESTORED_VERSION_VERIFIED','ALREADY_OFF'].includes(result.status))
   return blocked('RESTORE_OUTCOME_UNRECOGNIZED');
  const verified=await inspectPostRestore(client,d1Reader,baselineVersion);
  if(verified.status!=='OFF_VERIFIED')return verified;
  if(before===null)return blocked('PRE_RESTORE_D1_STATE_UNVERIFIED');
  // An active job BEFORE rollback may still be in flight; cannot claim safe completion.
  if(!before.clean)return blocked('PRE_RESTORE_ACTIVE_OR_UNKNOWN_JOBS');
  return {...verified,watchdog:'ONE_SHOT_CLAIMED',flags:'ALL_ABSENT_OR_FALSE'};
 }catch(error){
  return blocked(error instanceof RestoreBlocked?error.reason:'RESTORE_OUTCOME_UNCERTAIN_DO_NOT_RETRY');
 }
}
export const WATCHDOG_CONFIG_FIELDS=NON_SECRET_FIELDS;
