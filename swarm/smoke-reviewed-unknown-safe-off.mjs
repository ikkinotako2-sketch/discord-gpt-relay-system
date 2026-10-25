// Pure candidate safety verdict for a future recovery/post-restore controller.
// No Cloudflare API, D1 access, model invocation, mutation or write permission.
// Crucially, a preserved reviewed historical UNKNOWN is NOT the same as CLEAN.
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
import {assessHistoricalUnknown} from './smoke-unknown-review.mjs';

export const HISTORICAL_UNKNOWN_FINGERPRINT=Object.freeze({
 status:'unknown',calls_used:1,cycles:1,stop_requested:0,active_slot:null,
 last_error:'MODEL_OUTCOME_UNKNOWN',created_at:1792838702623,
 updated_at:1792838752941,history_length:2,checkpoint_length:0
});
const fail=(reason)=>({status:'BLOCKED',reason,authorizesLiveActions:false});
const valid=x=>Number.isSafeInteger(x)&&x>=0;
function fingerprintMatches(row){
 return row!==null&&typeof row==='object'&&
  Object.entries(HISTORICAL_UNKNOWN_FINGERPRINT).every(([key,value])=>row[key]===value);
}
export function assessReviewedUnknownSafeOff({
 snapshot,rows,review,ownerCommentVerified,
 target,remoteBindings,deployment,watchdog,nowMs=Date.now()
}={}){
 if(!valid(nowMs)||nowMs<1e12)return fail('CLOCK_UNVERIFIED');
 if(target?.accountId!==DISCORD_SMOKE_TARGET.accountId||
    target?.worker!==DISCORD_SMOKE_TARGET.worker||
    target?.databaseId!==DISCORD_SMOKE_TARGET.databaseId)
  return fail('WRONG_DISCORD_TARGET');
 if(!Array.isArray(rows)||rows.length!==1||!fingerprintMatches(rows[0]))
  return fail('ORIGINAL_UNKNOWN_CHANGED_OR_UNVERIFIED');
 if(snapshot?.legacyActive!==0||snapshot?.swarmActive!==0||
    snapshot?.pendingStop!==0||snapshot?.unknownJobs!==1)
  return fail('ACTIVE_STOP_OR_EXTRA_UNKNOWN_UNVERIFIED');
 if(ownerCommentVerified!==true)return fail('OWNER_IDENTITY_UNVERIFIED');
 // assessHistoricalUnknown validates reviewedAt, URL format, the exact D1
 // record's original timestamps, and today's UTC day; it does NOT grant AI.
 const reviewed=assessHistoricalUnknown({
  snapshot,rows,review,nowMs,dailyReserved:0,dailyCap:6
 });
 if(reviewed.status!=='REVIEWED_HISTORICAL_UNKNOWN_NEEDS_ALL_LIVE_PREFLIGHTS')
  return fail('OWNER_REVIEW_UNVERIFIED');
 if(deployment?.percentage!==100||deployment?.baselineActive!==true||
    deployment?.deploymentIdVerified!==true)
  return fail('BASELINE_LIVE_100_PERCENT_UNVERIFIED');
 if(!Array.isArray(remoteBindings))return fail('SWARM_BINDINGS_UNVERIFIED');
 const db=remoteBindings.filter(x=>x?.type==='d1');
 const loop=remoteBindings.filter(x=>x?.name==='LOOP_DB');
 if(db.length!==1||loop.length!==1||db[0]!==loop[0]||
    loop[0].database_id!==DISCORD_SMOKE_TARGET.databaseId)
  return fail('DEDICATED_D1_BINDING_UNVERIFIED');
 for(const key of FLAGS){
  const found=remoteBindings.filter(x=>x?.name===key);
  if(found.length>1||(found.length===1&&
    (found[0].type!=='plain_text'||found[0].text!=='false')))
   return fail('SWARM_FLAG_NOT_OFF_'+key);
 }
 if(watchdog?.armed!==false||watchdog?.approval!=='NOT_APPROVED'||
    watchdog?.parked!==true)
  return fail('WATCHDOG_PARKED_UNVERIFIED');
 // Does not prove a new smoke completed or reserve upstream free Neurons.
 // Runtime wiring and real rollback/owner authorization are separate gates.
 return {
  status:'SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN',
  preservedUnknownCount:1,activeJobs:0,
  authorizesLiveActions:false,authorizesCleanupWrites:false,
  note:'Proof of stopped state only, not authority to deploy or infer.'
 };
}
