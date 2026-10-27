// OFFLINE-STAGED reconciliation between D1 six-call controller and Watchdog.
// Pure decisions only: no Worker import, D1 writes, Cloudflare calls or AI.
// Mock proof below NEVER authorizes restore/deployment/inference. A future
// trusted collector must independently validate every receipt and provenance.
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
import {HISTORICAL_UNKNOWN_FINGERPRINT} from './smoke-reviewed-unknown-safe-off.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validMs=n=>Number.isSafeInteger(n)&&n>=1e12;
const status=(code,reason,extra={})=>Object.freeze({
 status:code,reason,authorizesDeployment:false,authorizesInference:false,
 authorizesD1Writes:false,authorizesRestore:false,...extra
});
const stopped=(reason,extra={})=>status('BLOCKED_MANUAL_REVIEW',reason,extra);
const exactTarget=t=>t?.accountId===DISCORD_SMOKE_TARGET.accountId&&
 t.worker===DISCORD_SMOKE_TARGET.worker&&t.databaseId===DISCORD_SMOKE_TARGET.databaseId;
function correctFlags(bindings){
 if(!Array.isArray(bindings))return false;
 const db=bindings.filter(x=>x?.name==='LOOP_DB');
 const d1=bindings.filter(x=>x?.type==='d1');
 if(db.length!==1||d1.length!==1||db[0]!==d1[0]||db[0].type!=='d1'||
    db[0].database_id!==DISCORD_SMOKE_TARGET.databaseId)return false;
 for(const key of FLAGS){
  const entries=bindings.filter(x=>x?.name===key);
  if(entries.length>1||entries.length===1&&
    (entries[0].type!=='plain_text'||entries[0].text!=='false'))return false;
 }
 return true;
}
function originalUnknownMatches(row){
 return row!==null&&typeof row==='object'&&
  Object.entries(HISTORICAL_UNKNOWN_FINGERPRINT).every(([k,v])=>row[k]===v);
}
function validController(s,now){
 return s?.schema==='discord-six-call.v1'&&
  typeof s.runId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(s.runId)&&
  typeof s.taskReceiptId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(s.taskReceiptId)&&
  exactTarget(s.target)&&
  UUID.test(s.baselineVersion||'')&&UUID.test(s.smokeVersion||'')&&
  s.baselineVersion!==s.smokeVersion&&validMs(s.createdAtMs)&&
  validMs(s.expiresAtMs)&&s.expiresAtMs>s.createdAtMs&&
  s.expiresAtMs-s.createdAtMs<=20*60*1000&&
  validMs(now)&&now>=s.createdAtMs&&
  Number.isSafeInteger(s.attempts)&&s.attempts>=0&&s.attempts<=6&&
  Number.isSafeInteger(s.completed)&&s.completed>=0&&s.completed<=s.attempts&&
  Number.isSafeInteger(s.revision)&&s.revision>=0&&
  typeof s.stopRequested==='boolean'&&
  (s.inFlightIndex===null||Number.isSafeInteger(s.inFlightIndex)&&
    s.inFlightIndex===s.attempts-1)&&
  s.historicalUnknownPreserved===true&&
  s.authorizesInference===false&&s.authorizesDeployment===false&&
  ['PENDING','ACTIVE','RESTORE_REQUIRED','RESTORED','BLOCKED'].includes(s.phase);
}
function claimsMatch(controller,claims){
 if(!Array.isArray(claims)||claims.length!==controller.attempts)return false;
 let completed=0,claimed=0;
 const sorted=[...claims].sort((a,b)=>a.stage_index-b.stage_index);
 for(let i=0;i<sorted.length;i++){
  const c=sorted[i];
  if(c.stage_index!==i||c.run_id!==controller.runId||
    !['FINAL_VERIFIED','CLAIMED','UNKNOWN'].includes(c.state))return false;
  if(c.state==='FINAL_VERIFIED')completed++;
  if(c.state==='CLAIMED')claimed++;
  if(c.state==='UNKNOWN'&&
     (controller.phase==='ACTIVE'||i!==sorted.length-1))return false;
  if(c.state==='CLAIMED'&&c.stage_index!==controller.inFlightIndex)return false;
 }
 return completed===controller.completed&&claimed===(controller.inFlightIndex===null?0:1);
}
function watchdogProof(s,w,now){
 if(!w||w.mode!=='OFFLINE_SIMULATED_WATCHDOG_RECEIPT'||
    w.target?.accountId!==s.target.accountId||
    w.target?.worker!==s.target.worker||
    w.target?.databaseId!==s.target.databaseId||
    w.baselineVersion!==s.baselineVersion||w.smokeVersion!==s.smokeVersion||
    w.expiresAtMs!==s.expiresAtMs||!validMs(w.armedAtMs)||
    w.armedAtMs<s.createdAtMs||w.armedAtMs>=s.expiresAtMs||
    !validMs(w.trafficSwitchedAtMs)||
    w.trafficSwitchedAtMs<=w.armedAtMs||
    w.trafficSwitchedAtMs>=s.expiresAtMs||
    w.alarmPersisted!==true||w.onceLatchPersisted!==true||
    w.independentWorkerIdentityVerified!==true||
    w.releaseSerializationHeld!==true||w.ownerRecoveryApprovalScoped!==true||
    w.armedAtMs>now)return false;
 return true;
}
function postRestoreOK(s,p,now){
 if(!p||p.mode!=='OFFLINE_SIMULATED_POSTRESTORE_RECEIPT'||
  !validMs(p.checkedAtMs)||p.checkedAtMs>now||now-p.checkedAtMs>5*60*1000||
  p.target?.accountId!==s.target.accountId||
  p.target?.worker!==s.target.worker||
  p.target?.databaseId!==s.target.databaseId||
  p.baselineVersion!==s.baselineVersion||
  !UUID.test(p.deploymentId||'')||
  p.deployedVersion!==s.baselineVersion||
  p.deployedPercentage!==100||
  p.releaseLockHeld!==true||p.signedDiscordRequestRejected401!==true||
  p.ownerStopRouteVerified!==true||
  p.watchdogParked!==true||p.watchdogArmed!==false||
  p.activeLegacyJobs!==0||p.activeSixRoleJobs!==0||
  p.pendingStopJobs!==0||p.historicalUnknownCount!==1||
  !originalUnknownMatches(p.originalUnknown)||!correctFlags(p.remoteBindings)||
  p.controllerRunId!==s.runId||p.controllerInFlightIndex!==null)return false;
 return true;
}
/**
 * Only offline/mock receipts can be interpreted by this module. They must
 * never be used as production release authority. All failure paths are
 * manual recovery / no retry and cannot attempt the provider.
 */
export function reconcileSixCallSmoke({controller,claims,watchdog,postRestore,nowMs}={}){
 if(!validController(controller,nowMs))
  return stopped('D1_CONTROLLER_STATE_INVALID_OR_MISSING');
 if(!claimsMatch(controller,claims))
  return stopped('CLAIM_LEDGER_OR_INFLIGHT_UNVERIFIED');
 if(controller.phase==='PENDING'||controller.phase==='BLOCKED')
  return status('NOT_RUNNING','PENDING_OR_BLOCKED_NO_INFERENCE');
 if(!watchdogProof(controller,watchdog,nowMs))
  return stopped('INDEPENDENT_PREARM_OR_RELEASE_FENCE_UNVERIFIED');
 if(controller.phase==='ACTIVE'){
  if(controller.stopRequested||controller.inFlightIndex!==null||
     nowMs>=controller.expiresAtMs)
   return status('HOLD_FOR_STOP_AND_RESTORE','INFLIGHT_STOP_OR_EXPIRY',
    {reservedAttempts:controller.attempts,verifiedFinals:controller.completed,
     manualRecoveryRequired:controller.inFlightIndex!==null});
  return status('ACTIVE_OBSERVATION_ONLY','ACTIVE_NOT_AUTHORIZED_HERE',
   {reservedAttempts:controller.attempts,verifiedFinals:controller.completed});
 }
 if(controller.phase!=='RESTORE_REQUIRED'&&controller.phase!=='RESTORED')
  return stopped('UNSUPPORTED_CONTROLLER_PHASE');
 if(!postRestoreOK(controller,postRestore,nowMs))
  return stopped('POSTRESTORE_BASELINE_FLAGS_OR_HISTORICAL_UNKNOWN_UNVERIFIED',
    {reservedAttempts:controller.attempts,verifiedFinals:controller.completed});
 if(controller.inFlightIndex!==null)
  return stopped('UNRESOLVED_INFLIGHT_PROVIDER_CALL');
 const full=controller.attempts===6&&controller.completed===6&&
   claims.every(x=>x.state==='FINAL_VERIFIED');
 return status(full?'SIMULATED_SAFE_OFF_SIX_FINALS':'SIMULATED_SAFE_OFF_INCOMPLETE',
  full?'OFFLINE_SIX_RESULTS_AND_OFF_PROOF':'OFFLINE_RESTORED_WITH_INCOMPLETE_OR_UNKNOWN',
  {reservedAttempts:controller.attempts,verifiedFinals:controller.completed,
   originalUnknownPreserved:true,productionVerification:false});
}
