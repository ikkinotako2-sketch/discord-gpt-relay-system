// Fail-closed READ-ONLY live evidence bundle for Discord's preserved UNKNOWN.
// HTTP operations: Cloudflare GET, GitHub GET, Cloudflare D1 REST POST with SQL SELECT.
// NEVER deploys, invokes a model, writes D1, changes a token, or authorizes launch.
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
import {createDiscordD1ReadClient} from './smoke-watchdog-d1.mjs';
import {capturePreservedUnknownReadOnly,DISCORD_UNKNOWN_OWNER_COMMENT}
 from './smoke-historical-evidence-readonly.mjs';
import {verifyUnknownReviewComment} from './smoke-owner-approval.mjs';
import {assessReviewedUnknownSafeOff} from './smoke-reviewed-unknown-safe-off.mjs';

const BASELINE='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const WATCHDOG='discord-smoke-independent-watchdog-staged';
const ROOT='https://api.cloudflare.com/client/v4/accounts/'+
 DISCORD_SMOKE_TARGET.accountId+'/workers/scripts/';
const denied=(reason)=>({status:'BLOCKED',reason,authorizesLiveActions:false});
const plain=(bs,name,val)=>{
 const matches=bs.filter(x=>x?.name===name);
 return matches.length===1&&matches[0].type==='plain_text'&&matches[0].text===val;
};
function exactBaselineBindings(bs){
 if(!Array.isArray(bs))return false;
 const db=bs.filter(x=>x?.type==='d1');
 const matches=bs.filter(x=>x?.name==='LOOP_DB');
 return db.length===1&&matches.length===1&&db[0]===matches[0]&&
  db[0].database_id===DISCORD_SMOKE_TARGET.databaseId&&
  FLAGS.every(k=>{
   const entries=bs.filter(x=>x?.name===k);
   return entries.length<=1&&(entries.length===0||
    (entries[0].type==='plain_text'&&entries[0].text==='false'));
  });
}
async function cfGet(worker,suffix,token,fetchImpl){
 const response=await fetchImpl(ROOT+worker+suffix,{
  method:'GET',headers:{Authorization:'Bearer '+token},
  signal:AbortSignal.timeout(12000)
 });
 if(response?.status!==200)throw Error('REMOTE_READ_UNVERIFIED');
 const data=await response.json();
 if(data?.success!==true||data.result===undefined)
  throw Error('REMOTE_RESULT_UNVERIFIED');
 return data.result;
}
export async function collectReviewedUnknownSafeOff({
 primaryReadToken,watchdogReadToken,d1ReadToken,
 fetchImpl=fetch,githubFetchImpl=fetch,nowMs=Date.now()
}={}){
 if(!Number.isSafeInteger(nowMs)||nowMs<1e12)
  return denied('CLOCK_UNVERIFIED');
 if([primaryReadToken,watchdogReadToken,d1ReadToken].some(
  x=>typeof x!=='string'||x.length<8
 )||typeof fetchImpl!=='function'||typeof githubFetchImpl!=='function')
  return denied('MISSING_READ_ONLY_CREDENTIAL');
 try{
  const [deploy,primarySettings,baseline,watchSettings,schedules,secrets]=await Promise.all([
   cfGet(DISCORD_SMOKE_TARGET.worker,'/deployments',primaryReadToken,fetchImpl),
   cfGet(DISCORD_SMOKE_TARGET.worker,'/settings',primaryReadToken,fetchImpl),
   cfGet(DISCORD_SMOKE_TARGET.worker,'/versions/'+BASELINE,primaryReadToken,fetchImpl),
   cfGet(WATCHDOG,'/settings',watchdogReadToken,fetchImpl),
   cfGet(WATCHDOG,'/schedules',watchdogReadToken,fetchImpl),
   cfGet(WATCHDOG,'/secrets',watchdogReadToken,fetchImpl)
  ]);
  const live=deploy?.deployments?.[0];
  const pinned=Array.isArray(deploy?.deployments)&&deploy.deployments.length>=1&&
   live?.versions?.length===1&&live.versions[0].percentage===100&&
   live.versions[0].version_id===BASELINE&&
   typeof live.id==='string'&&
   baseline?.id===BASELINE&&
   exactBaselineBindings(primarySettings?.bindings)&&
   exactBaselineBindings(baseline?.resources?.bindings);
  if(!pinned)return denied('PRIMARY_BASELINE_OR_REMOTE_BINDINGS_UNVERIFIED');
  const wb=watchSettings?.bindings;
  const parked=Array.isArray(wb)&&[
   ['WATCHDOG_ARMED','false'],['WATCHDOG_APPROVAL','NOT_APPROVED'],
   ['WATCHDOG_BASELINE_VERSION','UNSET'],['WATCHDOG_SMOKE_VERSION','UNSET'],
   ['WATCHDOG_EXPECTED_DEPLOYMENT_ID','UNSET'],['WATCHDOG_EXPIRES_AT','UNSET']
  ].every(([k,v])=>plain(wb,k,v));
  const cron=Array.isArray(schedules?.schedules)&&schedules.schedules.length===1&&
   schedules.schedules[0].cron==='* * * * *';
  const names=Array.isArray(secrets)&&
   ['WATCHDOG_RESTORE_TOKEN','WATCHDOG_D1_READ_TOKEN'].every(k=>
    secrets.filter(s=>s?.name===k).length===1);
  if(!parked||!cron||!names)return denied('WATCHDOG_PARKED_SCHEDULE_OR_SECRET_NAMES_UNVERIFIED');
  const d1=createDiscordD1ReadClient({token:d1ReadToken,fetchImpl});
  // Sequential snapshots are not a database lock. Revalidate immediately
  // before any separately owner-approved future release.
  const initial=await d1.snapshot();
  const historical=await capturePreservedUnknownReadOnly({d1ReadToken,fetchImpl,nowMs});
  const owner=await verifyUnknownReviewComment({
   ownerApprovalReference:DISCORD_UNKNOWN_OWNER_COMMENT,
   unknownCreatedAt:historical.rows[0].created_at,
   unknownUpdatedAt:historical.rows[0].updated_at,
   nowMs,fetchImpl:githubFetchImpl
  });
  if(owner.ownerCommentVerified!==true)return denied('HISTORICAL_OWNER_REVIEW_NOT_VERIFIED');
  const final=await d1.snapshot();
  if(JSON.stringify(initial)!==JSON.stringify(final))
   return denied('D1_SNAPSHOTS_CHANGED_DURING_READ');
  // No account-wide Workers AI quota or permission is inferred here.
  const result=assessReviewedUnknownSafeOff({
   target:DISCORD_SMOKE_TARGET,snapshot:final,
   snapshotCheckedAt:nowMs,
   rows:historical.rows,review:owner.review,ownerCommentVerified:true,
   dailyReserved:historical.dailyReserved,dailyCap:historical.dailyCap,
   budgetUtcDay:historical.utcDay,budgetCheckedAt:historical.checkedAt,
   remoteBindings:baseline.resources.bindings,
   deployment:{baselineActive:true,percentage:100,deploymentIdVerified:true,checkedAt:nowMs},
   watchdog:{armed:false,approval:'NOT_APPROVED',parked:true,checkedAt:nowMs},
   nowMs
  });
  return {...result,source:'GET_AND_SELECT_ONLY_NONATOMIC_SNAPSHOT',
   checkedAt:nowMs,accountWideFreeNeurons:'UNVERIFIED',
   modelAccess:'UNVERIFIED',realRollback:'UNVERIFIED',
   authorizesLiveActions:false};
 }catch{
  return denied('READ_ONLY_EVIDENCE_INCOMPLETE');
 }
}
