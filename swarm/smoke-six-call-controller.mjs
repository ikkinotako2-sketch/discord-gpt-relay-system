// Discord-only, deployment-disconnected controller core for ONE six-role smoke.
// No Cloudflare fetch, credentials, D1 implementation, deployment or production import.
// Every dependency is a capability supplied by a separately reviewed runtime adapter.
// A live adapter MUST independently authenticate owner consent, perform current
// account-wide provider checks, and implement durable atomic claim-before-invoke.
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

export const SMOKE_ATTEMPT_LIMIT=6;
export const SMOKE_MAX_WINDOW_MS=20*60*1000;
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const ID=/^[A-Za-z0-9_-]{8,100}$/;
const ms=n=>Number.isSafeInteger(n)&&n>=1e12;
const blocked=reason=>({status:'BLOCKED',reason,authorizesDeployment:false,authorizesInference:false});
const identical=(a,b)=>a.accountId===b?.accountId&&a.worker===b?.worker&&a.databaseId===b?.databaseId;

/** This is a NON-ACTIVE draft. An independent reviewed coordinator and real
 * owner OAuth+CSRF are required to create a persisted ACTIVE state. */
export function makeSixCallCandidate({runId,taskReceiptId,baselineVersion,smokeVersion,nowMs,expiresAtMs}={}){
 if(!ID.test(runId||'')||!ID.test(taskReceiptId||'')||
   !UUID.test(baselineVersion||'')||!UUID.test(smokeVersion||'')||
   baselineVersion===smokeVersion||!ms(nowMs)||!ms(expiresAtMs)||
   expiresAtMs<=nowMs||expiresAtMs-nowMs>SMOKE_MAX_WINDOW_MS)
   return blocked('INVALID_SCOPE_OR_EXPIRY');
 return Object.freeze({schema:'discord-six-call.v1',phase:'PENDING_EXTERNAL_ACTIVATION',
   runId,taskReceiptId,baselineVersion,smokeVersion,
   target:DISCORD_SMOKE_TARGET,createdAtMs:nowMs,expiresAtMs,
   attempts:0,completed:0,revision:0,inFlightIndex:null,stopRequested:false,
   historicalUnknownPreserved:true,authorizesDeployment:false,
   authorizesInference:false});
}

function validateState(s,now){
 if(!s||s.schema!=='discord-six-call.v1'||s.phase!=='ACTIVE'||
   !ID.test(s.runId||'')||!ID.test(s.taskReceiptId||'')||
   !identical(DISCORD_SMOKE_TARGET,s.target)||
   !UUID.test(s.baselineVersion||'')||!UUID.test(s.smokeVersion||'')||
   s.baselineVersion===s.smokeVersion||
   !ms(s.createdAtMs)||!ms(s.expiresAtMs)||
   s.expiresAtMs<=s.createdAtMs||
   s.expiresAtMs-s.createdAtMs>SMOKE_MAX_WINDOW_MS||
   !ms(now)||now<s.createdAtMs||now>=s.expiresAtMs||
   !Number.isSafeInteger(s.revision)||s.revision<0||
   !Number.isSafeInteger(s.attempts)||s.attempts<0||
   s.attempts>=SMOKE_ATTEMPT_LIMIT||
   s.completed!==s.attempts||s.inFlightIndex!==null||
   s.stopRequested!==false||s.historicalUnknownPreserved!==true||
   s.authorizesInference!==false||s.authorizesDeployment!==false)
   return false;
 return true;
}

// IMPORTANT: the production adapter has to obtain these fields itself from
// *trusted* live sources; arbitrary caller objects must never be forwarded.
// This check limits misuse but cannot attest signatures/provider reservations.
export function validLiveStepEvidence(e,s,now){
 if(!e||e.status!=='VERIFIED_FROM_TRUSTED_ADAPTER'||
    !ms(e.checkedAtMs)||e.checkedAtMs>now||now-e.checkedAtMs>5*60*1000||
    !identical(DISCORD_SMOKE_TARGET,e.target)||
    e.runId!==s.runId||e.taskReceiptId!==s.taskReceiptId||
    e.activeVersion!==s.smokeVersion||e.baselineVersion!==s.baselineVersion||
    e.expiresAtMs!==s.expiresAtMs||
    e.ownerOauthCsrfVerified!==true||e.newExplicitOwnerConsentVerified!==true||
    e.watchdogIndependentlyPrearmed!==true||e.watchdogLiveRestoreTested!==true||
    e.releaseLockFencingVerified!==true||e.remoteFourFlagsEnabledAndBounded!==true||
    e.d1HistoryUnknownExactlyPreserved!==true||e.legacyActiveJobs!==0||
    e.otherSixRoleJobs!==0||e.pendingStopJobs!==0||
    e.accountPlanFreeVerified!==true||e.modelAvailableVerified!==true||
    e.accountWideSixCallsFreeMarginVerified!==true||e.unrelatedAiIdleVerified!==true||
    e.githubActiveReleaseRuns!==0||e.emergencyStopReachable!==true)
   return false;
 return true;
}

/**
 * Execute AT MOST ONE inference attempt. The persistent store MUST implement
 * globally atomic claimOnce CAS + local day reservation in the same transaction.
 * A claim is irreversible even if provider times out, commit fails, or call is
 * cancelled. NEVER retry unknown. Missing/fake adapter -> blocked.
 * No implementation of the adapter or inference provider is included here.
 */
export async function runSixCallStep({store,liveEvidence,provider,clock=Date.now}={}){
 if(typeof store?.read!=='function'||typeof store?.claimOnce!=='function'||
    typeof store?.finishOnce!=='function'||typeof liveEvidence?.collect!=='function'||
    typeof provider?.invoke!=='function'||typeof clock!=='function')
   return blocked('REQUIRED_TRUSTED_ADAPTERS_MISSING');
 let now,s;
 try{now=clock();s=await store.read();}catch{return blocked('STATE_READ_OR_CLOCK_FAILED');}
 if(!validateState(s,now))return blocked('NOT_ACTIVE_INVALID_OR_EXPIRED');
 let evidence;
 try{evidence=await liveEvidence.collect({runId:s.runId,index:s.attempts,atMs:now});}
 catch{return blocked('LIVE_EVIDENCE_UNAVAILABLE');}
 // Recheck clock immediately before durable claim to avoid stale evidence.
 let claimTime;
 try{claimTime=clock();}catch{return blocked('CLOCK_UNAVAILABLE');}
 if(!ms(claimTime)||claimTime<now||claimTime>=s.expiresAtMs||
    !validLiveStepEvidence(evidence,s,claimTime))return blocked('LIVE_GATES_NOT_VERIFIED');
 const index=s.attempts;
 let claim;
 try{
   claim=await store.claimOnce({runId:s.runId,expectedRevision:s.revision,
     index,expectedExpiryMs:s.expiresAtMs,nowMs:claimTime,localDailyCap:6});
 }catch{return blocked('DURABLE_CLAIM_OUTCOME_UNKNOWN_DO_NOT_RETRY');}
 // Not knowing whether claim was durable means no provider invocation.
 if(!claim||claim.claimed!==true||claim.runId!==s.runId||
    claim.revision!==s.revision+1||claim.index!==index||
    claim.attempts!==index+1||claim.completed!==index||
    claim.inFlightIndex!==index)
   return blocked('ATOMIC_CLAIM_UNVERIFIED_DO_NOT_RETRY');
 let outcome='UNKNOWN';
 try{
   // An owner STOP can arrive after the durable claim but before invocation.
   // Re-read live D1: if STOP, expiry, fencing change or read failure is seen,
   // consume this already-reserved attempt as UNKNOWN rather than invoke AI.
   // This narrows the race; a STOP after this read may still overlap a call
   // already in flight and requires independent Watchdog/manual recovery.
   const rechecked=await store.read();
   if(!rechecked||rechecked.schema!=='discord-six-call.v1'||
      rechecked.runId!==s.runId||
      rechecked.taskReceiptId!==s.taskReceiptId||
      !identical(DISCORD_SMOKE_TARGET,rechecked.target)||
      rechecked.baselineVersion!==s.baselineVersion||
      rechecked.smokeVersion!==s.smokeVersion||
      rechecked.expiresAtMs!==s.expiresAtMs||
      rechecked.phase!=='ACTIVE'||rechecked.stopRequested!==false||
      rechecked.attempts!==index+1||rechecked.completed!==index||
      rechecked.inFlightIndex!==index||
      rechecked.revision!==claim.revision||
      rechecked.authorizesInference!==false||
      rechecked.authorizesDeployment!==false)
      throw Error('DURABLE_CLAIM_POSTCHECK_OR_STOP_FAILED');
   // Atomic claim may have been delayed. Never invoke after window expiry.
   const beforeInvoke=clock();
   if(!ms(beforeInvoke)||beforeInvoke<claimTime||beforeInvoke>=s.expiresAtMs)
     throw Error('DEADLINE_AFTER_CLAIM');
   const result=await provider.invoke({runId:s.runId,stageIndex:index,
     taskReceiptId:s.taskReceiptId,claimRevision:claim.revision});
   if(result?.status==='FINAL_VERIFIED'&&result.stageIndex===index&&
      typeof result.receiptId==='string'&&ID.test(result.receiptId))
     outcome='FINAL_VERIFIED';
 }catch{/* Claimed/reserved index becomes UNKNOWN, never retried. */}
 let finish;
 try{
   finish=await store.finishOnce({runId:s.runId,index,
     expectedClaimRevision:claim.revision,outcome,nowMs:clock()});
 }catch{return blocked('SETTLEMENT_UNCERTAIN_DO_NOT_RETRY');}
 // Even a valid final result after deadline must not authorize another call.
 if(!finish||finish.runId!==s.runId||finish.revision!==claim.revision+1||
    finish.attempts!==index+1||finish.inFlightIndex!==null||
    finish.completed!==(index+(outcome==='FINAL_VERIFIED'?1:0)))
   return blocked('SETTLEMENT_UNVERIFIED_DO_NOT_RETRY');
 if(outcome==='UNKNOWN')return {status:'UNKNOWN_STOP',attempts:index+1,
   completed:index,restoreRequired:true,authorizesInference:false};
 if(index+1===SMOKE_ATTEMPT_LIMIT)return {status:'SIX_CALL_LIMIT_REACHED',
   attempts:6,completed:6,restoreRequired:true,authorizesInference:false};
 const after=clock();
 if(!ms(after)||after>=s.expiresAtMs)return {status:'EXPIRED_RESTORE_REQUIRED',
   attempts:index+1,completed:index+1,restoreRequired:true,authorizesInference:false};
 return {status:'STEP_COMPLETE',attempts:index+1,completed:index+1,
   restoreRequired:false,authorizesInference:false};
}
