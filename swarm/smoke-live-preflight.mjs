// Offline-only preflight evidence evaluator. NO API access, Worker deployment,
// D1 access, secrets, or authority to start inference. Intended for live evidence review.
import {DISCORD_SMOKE_TARGET, FLAGS} from './smoke-restore-guard.mjs';
import {assessHistoricalUnknown} from './smoke-unknown-review.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRESH_MS=5*60*1000;
const NEURONS_PER_DAY=10000;
const REQUIRED_GATES=Object.freeze([
 'discordOwnerOauth','unsignedDiscordSignatureRejects',
 'baselineRollbackLiveTested','watchdogCronIndependentVerified',
 'watchdogOneShotLatchVerified','releaseSerializationVerified',
 'failureAlertAndManualRecoveryVerified','providerModelAccessVerified'
]);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const validTime=(t,now)=>int(t)&&t<=now&&now-t<=FRESH_MS;
const dayUTC=now=>new Date(now).toISOString().slice(0,10);
export const LIVE_READINESS_GATES=REQUIRED_GATES;
export function assessDiscordSmokePreflight(evidence={},nowMs=Date.now()){
 const missing=[];
 const reject=s=>{if(!missing.includes(s))missing.push(s);};
 if(!int(nowMs)||nowMs<1_000_000_000_000)return {status:'BLOCKED',blockers:['CURRENT_CLOCK_UNVERIFIED'],authorizesLiveActions:false};
 if(evidence?.target?.accountId!==DISCORD_SMOKE_TARGET.accountId ||
    evidence?.target?.worker!==DISCORD_SMOKE_TARGET.worker ||
    evidence?.target?.databaseId!==DISCORD_SMOKE_TARGET.databaseId)
   reject('WRONG_OR_UNVERIFIED_DISCORD_RESOURCES');
 if(!validTime(evidence?.checkedAt,nowMs))reject('PREFLIGHT_SNAPSHOT_STALE');
 const versions=evidence?.versions;
 if(!UUID.test(versions?.baseline||'')||!UUID.test(versions?.smoke||'')||
    versions?.baseline===versions?.smoke||!UUID.test(versions?.deployment||'')||
    versions?.active!==versions?.baseline)
   reject('BASELINE_OR_SMOKE_VERSIONS_UNVERIFIED');
 if(!Array.isArray(evidence?.remoteBindings))reject('SWARM_FLAGS_UNVERIFIED');
 else{
  for(const key of FLAGS){
   const matches=evidence.remoteBindings.filter(b=>b?.name===key);
   if(matches.length>1 || (matches.length===1 &&
     (matches[0].type!=='plain_text'||matches[0].text!=='false')))
    reject('SWARM_FLAG_NOT_OFF_'+key);
  }
  // Reject shadow/duplicate LOOP_DB names even when a correct D1 is also present.
  // A conflicting binding could otherwise make the remote configuration ambiguous.
  const db=evidence.remoteBindings.filter(b=>b?.type==='d1');
  const loopBindings=evidence.remoteBindings.filter(b=>b?.name==='LOOP_DB');
  if(db.length!==1||loopBindings.length!==1||db[0]!==loopBindings[0]||
     db[0].database_id!==DISCORD_SMOKE_TARGET.databaseId)
    reject('DISCORD_D1_BINDING_UNVERIFIED');
 }
 const jobs=evidence?.jobs;
 let reviewedHistoricalUnknown=false;
 if(!jobs||!['legacyActive','swarmActive','unknownJobs','pendingStop'].every(k=>int(jobs[k])))
   reject('ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
 else if(jobs.unknownJobs===1&&jobs.legacyActive===0&&jobs.swarmActive===0&&jobs.pendingStop===0){
   const h=evidence?.historicalUnknown;
   const a=assessHistoricalUnknown({snapshot:jobs,rows:h?.rows,review:h?.review,
     nowMs,dailyReserved:h?.dailyReserved,dailyCap:h?.dailyCap});
   // A URL alone does not prove owner identity. Authenticated verifier remains mandatory.
   if(a.status==='REVIEWED_HISTORICAL_UNKNOWN_NEEDS_ALL_LIVE_PREFLIGHTS'&&h?.ownerCommentVerified===true)
     reviewedHistoricalUnknown=true;
   else reject('ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
 }else if(jobs.legacyActive!==0||jobs.swarmActive!==0||jobs.unknownJobs!==0||jobs.pendingStop!==0)
   reject('ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
 if(!int(evidence?.githubActiveRuns)||evidence.githubActiveRuns!==0)
  reject('GITHUB_ACTIONS_IN_PROGRESS_OR_UNVERIFIED');
 const acct=evidence?.account;
 if(acct?.plan!=='free')reject('FREE_PLAN_NOT_VERIFIED');
 if(!int(acct?.cronTriggers) || acct.cronTriggers>=5)
  reject('FREE_CRON_SLOT_UNAVAILABLE_OR_UNKNOWN');
 if(!int(acct?.neuronsUsed)||acct.neuronsUsed>NEURONS_PER_DAY||
    acct?.neuronQuota!==NEURONS_PER_DAY||acct?.utcDay!==dayUTC(nowMs)||
    !validTime(acct?.usageCheckedAt,nowMs)||acct?.usageSource!=='cloudflare_workers_ai_dashboard')
   reject('CURRENT_ACCOUNT_WIDE_NEURON_USAGE_UNVERIFIED');
 else{
  // Usage dashboard evidence is not a provider-side reservation: never a greenlight.
  if(!int(acct?.conservativeSixCallReservation)||acct.conservativeSixCallReservation===0||
    acct.conservativeSixCallReservation>NEURONS_PER_DAY-acct.neuronsUsed)
    reject('SIX_CALL_FREE_BUDGET_NOT_SUPPORTED');
 }
 if(acct?.unrelatedAiJobsIdle!==true)reject('UNRELATED_AI_USAGE_NOT_EXCLUDED');
 if(!Number.isSafeInteger(evidence?.deadlineMs)||evidence.deadlineMs<=nowMs||
    evidence.deadlineMs-nowMs>20*60*1000||
    !/^\d{13}$/.test(String(evidence.deadlineMs)))
   reject('SMOKE_EXPIRY_NOT_BOUNDED');
 for(const gate of REQUIRED_GATES)
  if(evidence?.gates?.[gate]!==true)reject('UNVERIFIED_'+gate.toUpperCase());
 if(missing.length)return {status:'BLOCKED',blockers:missing,authorizesLiveActions:false};
 // Explicitly NEVER returns READY/ALLOW; metrics may lag or another agent may
 // consume the account-wide allowance between observations. Owner must review.
 return {status:'OWNER_REVIEW_REQUIRED',
  blockers:['REALTIME_QUOTA_NOT_RESERVED','NON_ATOMIC_DEPLOYMENT_REQUIRES_LIVE_COORDINATION',
   ...(reviewedHistoricalUnknown?['HISTORICAL_UNKNOWN_PRESERVED_RUNTIME_REVIEW_NOT_WIRED']:[])],
  authorizesLiveActions:false,
  note:'All supplied evidence predicates passed. This is not a license to deploy or infer.'};
}
