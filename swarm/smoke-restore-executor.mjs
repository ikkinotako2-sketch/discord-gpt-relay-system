// Staged executor: real Cloudflare API adapter, deliberately NOT invoked by CI or Cron.
// No scheduling, uploading, D1 mutations, inference, flags, or secrets changes.
import {decideSmokeRestore, DISCORD_SMOKE_TARGET, FLAGS} from './smoke-restore-guard.mjs';

const ACCOUNT=DISCORD_SMOKE_TARGET.accountId;
const WORKER=DISCORD_SMOKE_TARGET.worker;
const DATABASE=DISCORD_SMOKE_TARGET.databaseId;
const HOST='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
const LIVE_URL='https://'+WORKER+'.ikkinotako2.workers.dev/';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_SECRETS=['DISCORD_PUBLIC_KEY','DISCORD_ALLOWED_USER_ID','DISCORD_OAUTH_CLIENT_SECRET','DASHBOARD_COOKIE_KEY'];
const READY_MARKERS=new Set([
 'Discord GPT Relay gpt-oss pilot ready.',
 'Discord GPT Relay gpt-oss command-center ready.'
]);
export class RestoreBlocked extends Error {
 constructor(reason){super(reason);this.name='RestoreBlocked';this.reason=reason;}
}
function block(reason){throw new RestoreBlocked(reason);}
function requireUuid(value,reason){if(typeof value!=='string'||!uuid.test(value))block(reason);}
function exactPlain(bindings,name){
 const found=bindings.filter(b=>b && b.name===name);
 if(found.length>1)block('DUPLICATE_BINDING_'+name);
 if(found.length===0)return null;
 if(found[0].type!=='plain_text'||typeof found[0].text!=='string')block('AMBIGUOUS_BINDING_'+name);
 return found[0].text;
}
function validateBindings(bindings,kind){
 if(!Array.isArray(bindings))block('UNREADABLE_'+kind+'_BINDINGS');
 const db=bindings.filter(b=>b && b.type==='d1');
 if(db.length!==1||db[0].name!=='LOOP_DB'||db[0].database_id!==DATABASE)
  block('DISCORD_D1_BINDING_MISMATCH_'+kind);
 for(const name of REQUIRED_SECRETS){
  const found=bindings.filter(b=>b && b.name===name);
  if(found.length!==1||found[0].type!=='secret_text')block('MISSING_OR_AMBIGUOUS_SECRET_NAME_'+name);
 }
 for(const name of FLAGS){
  const v=exactPlain(bindings,name);
  if(kind==='baseline' && v!==null && v!=='false')block('BASELINE_FLAG_ENABLED_'+name);
  if(kind==='smoke' && v!=='true')block('SMOKE_FLAG_NOT_TRUE_'+name);
 }
 if(kind==='smoke' && exactPlain(bindings,'SWARM_DAILY_CALL_CAP')!=='6')
  block('SMOKE_CAP_NOT_SIX');
 return bindings;
}
function currentDeployment(data){
 const deployments=data && data.deployments;
 if(!Array.isArray(deployments)||deployments.length===0)block('DEPLOYMENTS_UNREADABLE');
 const sorted=[...deployments].sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on));
 const latest=sorted[0];
 if(!latest || !Number.isFinite(Date.parse(latest.created_on)) ||
    (sorted.length>1 && Date.parse(sorted[1].created_on)===Date.parse(latest.created_on)))
   block('LATEST_DEPLOYMENT_AMBIGUOUS');
 requireUuid(latest.id,'LATEST_DEPLOYMENT_ID_UNVERIFIED');
 if(latest.versions?.length!==1 || latest.versions[0].percentage!==100)
   block('SPLIT_OR_MISSING_ACTIVE_VERSION');
 requireUuid(latest.versions[0].version_id,'ACTIVE_VERSION_ID_UNVERIFIED');
 return {deploymentId:latest.id,versionId:latest.versions[0].version_id};
}
function sameDeployment(a,b){
 return a.deploymentId===b.deploymentId && a.versionId===b.versionId;
}
// One-shot adapter: all URLs are hardcoded to this Discord Worker, never PLM/YouTube.
export function createDiscordCloudflareClient({token,fetchImpl=fetch}={}){
 if(typeof token!=='string'||token.length<8)block('MISSING_CLOUDFLARE_TOKEN');
 if(typeof fetchImpl!=='function')block('MISSING_FETCH');
 async function api(method,path,payload){
  let response;
  try{
   response=await fetchImpl(HOST+path,{
    method,
    headers:{Authorization:'Bearer '+token,Accept:'application/json',
      ...(payload?{'Content-Type':'application/json'}:{})},
    ...(payload?{body:JSON.stringify(payload)}:{}),
    signal:AbortSignal.timeout(12000)
   });
  }catch{block('CLOUDFLARE_REQUEST_UNCERTAIN');}
  let body;
  try{body=await response.json();}catch{block('CLOUDFLARE_RESPONSE_NOT_JSON');}
  if(!response.ok||body?.success!==true||!body.result)
   block(method==='POST'?'RESTORE_POST_UNCERTAIN':'CLOUDFLARE_READ_FAILED');
  return body.result;
 }
 return {
  async deployment(){return currentDeployment(await api('GET','/deployments'));},
  async bindings(versionId){
   requireUuid(versionId,'INVALID_VERSION_ID');
   const r=await api('GET','/versions/'+versionId);
   if(r.id!==versionId)block('VERSION_DETAILS_ID_MISMATCH');
   return r.resources?.bindings;
  },
  async restore(versionId){
   requireUuid(versionId,'INVALID_RESTORE_VERSION');
   const result=await api('POST','/deployments',{
    strategy:'percentage',versions:[{percentage:100,version_id:versionId}],
    annotations:{'workers/message':'Owner-approved Discord-only smoke baseline restore'}
   });
   requireUuid(result.id,'RESTORE_RESPONSE_ID_UNVERIFIED');
   return result.id;
  },
  async health(){
   // No token is sent to the Worker URL; unsigned Discord POST should be rejected.
   let get,post;
   try{
    [get,post]=await Promise.all([
     fetchImpl(LIVE_URL,{method:'GET',signal:AbortSignal.timeout(12000)}),
     fetchImpl(LIVE_URL,{method:'POST',body:'{}',signal:AbortSignal.timeout(12000)})
    ]);
   }catch{block('POST_RESTORE_WORKER_HEALTH_UNVERIFIED');}
   if(get.status!==200||post.status!==401)block('POST_RESTORE_SECURITY_GATE_FAILED');
   let marker;
   try{marker=(await get.text()).trim();}catch{block('POST_RESTORE_WORKER_MARKER_UNREADABLE');}
   if(!READY_MARKERS.has(marker))block('POST_RESTORE_WORKER_MARKER_INVALID');
   return true;
  }
 };
}
/**
 * Can make a real one-shot baseline deployment ONLY if explicitly invoked by an
 * authorized future controller with execute=true and the exact approval string.
 * The controller, permanent watchdog, independent scheduler, token scope,
 * actual D1 terminal-status check and post-restore remote flag snapshot are
 * separate required live gates. This function is NOT a self-running watchdog.
 */
export async function restoreDiscordSmoke({
 client,baselineVersion,smokeVersion,expectedDeploymentId,expiryMs,
 nowMs=Date.now(),ownerEmergency=false,execute=false,approval=''
}={}){
 if(!execute||approval!=='RESTORE-DISCORD-SMOKE-BASELINE-ONCE')
  block('OWNER_EXECUTION_APPROVAL_REQUIRED');
 requireUuid(baselineVersion,'BASELINE_VERSION_UNVERIFIED');
 requireUuid(smokeVersion,'SMOKE_VERSION_UNVERIFIED');
 requireUuid(expectedDeploymentId,'EXPECTED_DEPLOYMENT_UNVERIFIED');
 if(baselineVersion===smokeVersion)block('SAME_VERSION_NOT_ALLOWED');
 if(!client || !['deployment','bindings','restore','health'].every(k=>typeof client[k]==='function'))
  block('CLIENT_INCOMPLETE');
 const before=await client.deployment();
 if(before.deploymentId!==expectedDeploymentId)block('INITIAL_DEPLOYMENT_CHANGED');
 const baselineBindings=validateBindings(await client.bindings(baselineVersion),'baseline');
 const liveBindings=validateBindings(await client.bindings(smokeVersion),'smoke');
 const decision=decideSmokeRestore({
  ...DISCORD_SMOKE_TARGET,baselineVersion,smokeVersion,currentVersions:[before.versionId],
  bindings:before.versionId===baselineVersion?baselineBindings:liveBindings,
  expiryMs,nowMs,ownerEmergency
 });
 if(decision.action==='ALREADY_OFF'){
  await client.health();
  return {status:'ALREADY_OFF',versionId:baselineVersion,worker:WORKER};
 }
 if(decision.action!=='RESTORE_BASELINE'||!decision.allowed)
  block('RESTORE_DECISION_'+decision.action+'_'+(decision.reason||''));
 // A second GET reduces races; Cloudflare's API does not offer compare-and-swap.
 const immediatelyBefore=await client.deployment();
 if(!sameDeployment(before,immediatelyBefore))block('CONCURRENT_DEPLOYMENT_CHANGED');
 // On any uncertain response DO NOT retry: a deployment might already exist.
 await client.restore(baselineVersion);
 const after=await client.deployment();
 if(after.versionId!==baselineVersion)block('POST_RESTORE_VERSION_UNVERIFIED_DO_NOT_RETRY');
 await client.health();
 // Worker version details are immutable; checked baseline OFF flags and D1 binding
 // above, but external controller MUST re-read remote bindings and D1 job state.
 return {status:'RESTORED_VERSION_VERIFIED',versionId:baselineVersion,worker:WORKER,
  deploymentId:after.deploymentId,followUp:'VERIFY_REMOTE_OFF_FLAGS_AND_D1_BEFORE_PASS'};
}
