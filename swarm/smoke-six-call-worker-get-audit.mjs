// READ-ONLY future safety observer for exact Discord-only Workers.
// Cloudflare API GET only; no D1 transport, Cloudflare POST, inference,
// deploy, scheduled work, secret retrieval/logging or authorizations.
// This module is STAGED and not imported by any production Worker.
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';

export const DISCORD_BASELINE_PIN='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
export const DISCORD_WATCHDOG_NAME='discord-smoke-independent-watchdog-staged';
const ROOT='https://api.cloudflare.com/client/v4/accounts/'+
 DISCORD_SMOKE_TARGET.accountId+'/workers/scripts/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const NOW=n=>Number.isSafeInteger(n)&&n>=1e12;
const fail=reason=>Object.freeze({
 status:'BLOCKED',reason,authorizesInference:false,authorizesDeployment:false,
 authorizesD1Writes:false,authorizesLiveActions:false
});
const response=(status,more)=>Object.freeze({
 status,source:'CLOUDFLARE_GET_ONLY_NONATOMIC',
 authorizesInference:false,authorizesDeployment:false,
 authorizesD1Writes:false,authorizesLiveActions:false,...more
});
const matching=(arr,name)=>arr.filter(x=>x?.name===name);
function exactOffBindings(b){
 if(!Array.isArray(b))return false;
 const databases=b.filter(x=>x?.type==='d1');
 const mapped=matching(b,'LOOP_DB');
 if(databases.length!==1||mapped.length!==1||databases[0]!==mapped[0]||
    mapped[0].database_id!==DISCORD_SMOKE_TARGET.databaseId)return false;
 for(const key of FLAGS){
  const x=matching(b,key);
  if(x.length>1||x.length===1&&(x[0].type!=='plain_text'||x[0].text!=='false'))
   return false;
 }
 return true;
}
const pinnedDeployment=(obj)=>{
 const ds=obj?.deployments;
 if(!Array.isArray(ds)||ds.length<1)return null;
 const d=ds[0];
 if(!UUID.test(d?.id||'')||!Array.isArray(d.versions)||d.versions.length!==1||
    d.versions[0].percentage!==100||
    d.versions[0].version_id!==DISCORD_BASELINE_PIN)return null;
 return {id:d.id,version:DISCORD_BASELINE_PIN,percentage:100};
};
const isPlain=(bs,name,text)=>{
 const r=matching(bs,name);
 return r.length===1&&r[0].type==='plain_text'&&r[0].text===text;
};
function parkedWatchdog(settings,schedules,secrets){
 const bs=settings?.bindings;
 if(!Array.isArray(bs))return false;
 const checks=[
  ['WATCHDOG_ARMED','false'],
  ['WATCHDOG_APPROVAL','NOT_APPROVED'],
  ['WATCHDOG_BASELINE_VERSION','UNSET'],
  ['WATCHDOG_SMOKE_VERSION','UNSET'],
  ['WATCHDOG_EXPECTED_DEPLOYMENT_ID','UNSET'],
  ['WATCHDOG_EXPIRES_AT','UNSET']
 ];
 if(!checks.every(([k,v])=>isPlain(bs,k,v)))return false;
 if(!Array.isArray(schedules?.schedules)||schedules.schedules.length!==1||
    schedules.schedules[0]?.cron!=='* * * * *')return false;
 if(!Array.isArray(secrets))return false;
 const names=['WATCHDOG_RESTORE_TOKEN','WATCHDOG_D1_READ_TOKEN'];
 if(!names.every(n=>secrets.filter(x=>x?.name===n).length===1))return false;
 return true;
}
/** Must run with read-only Cloudflare bearer scopes; this function does not
 * introspect token permissions, so the result is never live release proof.
 */
export async function collectDiscordWorkerSafeOffGet({
 primaryReadToken,watchdogReadToken,fetchImpl=fetch,clock=Date.now
}={}){
 if(typeof primaryReadToken!=='string'||primaryReadToken.length<8||
    typeof watchdogReadToken!=='string'||watchdogReadToken.length<8||
    typeof fetchImpl!=='function'||typeof clock!=='function')
   return fail('WORKER_GET_READ_CREDENTIAL_OR_CLIENT_MISSING');
 let start;
 try{start=clock();}catch{return fail('CLOCK_UNVERIFIED');}
 if(!NOW(start))return fail('CLOCK_UNVERIFIED');
 const get=async(worker,path,token)=>{
  const url=ROOT+worker+path;
  let raw,body;
  try{
   raw=await fetchImpl(url,{method:'GET',
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
   if(raw?.status!==200||raw?.ok!==true)throw Error('HTTP_NOT_OK');
   body=await raw.json();
  }catch{throw Error('REMOTE_GET_UNVERIFIED');}
  if(body?.success!==true||body.result===undefined||body.result===null)
   throw Error('REMOTE_RESPONSE_UNVERIFIED');
  return body.result;
 };
 try{
  const target=DISCORD_SMOKE_TARGET.worker;
  const before=await get(target,'/deployments',primaryReadToken);
  const active=pinnedDeployment(before);
  if(!active)return fail('PRIMARY_NOT_PINNED_BASELINE_100_PERCENT');
  const settings=await get(target,'/settings',primaryReadToken);
  const base=await get(target,'/versions/'+DISCORD_BASELINE_PIN,primaryReadToken);
  if(base?.id!==DISCORD_BASELINE_PIN||
     !exactOffBindings(settings?.bindings)||
     !exactOffBindings(base?.resources?.bindings))
   return fail('PRIMARY_REMOTE_D1_OR_ALL_FOUR_OFF_FLAGS_UNVERIFIED');
  const watchdog=DISCORD_WATCHDOG_NAME;
  const wdSettings=await get(watchdog,'/settings',watchdogReadToken);
  const wdSchedules=await get(watchdog,'/schedules',watchdogReadToken);
  // Only secret NAMES must be returned; this module never logs/stores values.
  const wdSecrets=await get(watchdog,'/secrets',watchdogReadToken);
  if(!parkedWatchdog(wdSettings,wdSchedules,wdSecrets))
   return fail('INDEPENDENT_WATCHDOG_NOT_PARKED_OR_SCHEDULE_UNVERIFIED');
  const after=pinnedDeployment(await get(target,'/deployments',primaryReadToken));
  if(!after||after.id!==active.id)
   return fail('PRIMARY_DEPLOYMENT_CHANGED_DURING_GET_AUDIT');
  let end;
  try{end=clock();}catch{return fail('CLOCK_UNVERIFIED');}
  if(!NOW(end)||end<start||end-start>5*60*1000)
   return fail('WORKER_GET_EVIDENCE_STALE');
  return response('WORKER_AND_WATCHDOG_PARKED_GET_REVIEW_ONLY',{
   checkedAtMs:end,accountId:DISCORD_SMOKE_TARGET.accountId,
   worker:target,baselineVersion:active.version,
   deploymentId:active.id,trafficPercentage:100,
   allFourSwarmFlagsOffObserved:true,discordD1BindingObserved:true,
   watchdog:DISCORD_WATCHDOG_NAME,watchdogArmed:false,
   watchdogScheduleObserved:true,watchdogSecretNamesObserved:true,
   independentRollbackLiveTested:false,
   signedDiscord401Verified:false,
   cloudflareD1JobsRead:false,accountWideNeuronsVerified:false,
   caveat:'Non-atomic GET snapshot. Secrets present and schedule configured do not prove an independent automatic rollback succeeds.'
  });
 }catch{return fail('REMOTE_WORKER_GET_EVIDENCE_INCOMPLETE');}
}
