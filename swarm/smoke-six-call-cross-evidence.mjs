// OFFLINE ONLY: fail-closed corroboration of separate read-only evidence.
// This consumes reports, never credentials, D1 queries, AI requests or deploys.
// A caller can forge reports; therefore ALL outputs remain non-authorizing.
// The actual authority is an independently reviewed LIVE collector + new owner
// approval, release serialization and a demonstrated independent rollback.
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
import {DISCORD_BASELINE_PIN,DISCORD_WATCHDOG_NAME}
 from './smoke-six-call-worker-get-audit.mjs';

const FIVE_MIN=5*60*1000;
const TWO_MIN=2*60*1000;
const stamp=n=>Number.isSafeInteger(n)&&n>=1e12;
const deny=(reason,other={})=>Object.freeze({
 status:'BLOCKED',reason,...other,
 authorizesInference:false,authorizesDeployment:false,
 authorizesMigration:false,authorizesD1Writes:false,
 authorizesWatchdogArming:false,authorizesLiveActions:false
});
const correctTarget=(a,w,d)=>a===DISCORD_SMOKE_TARGET.accountId&&
 w===DISCORD_SMOKE_TARGET.worker&&d===DISCORD_SMOKE_TARGET.databaseId;
const fresh=(x,now)=>stamp(x)&&x<=now&&now-x<=FIVE_MIN;
const SHA=/^[a-f0-9]{40}$/;
const IMMUTABLE_LIVE_BLOCKERS=Object.freeze([
 'DRAFT_PR_CHAIN_REVIEW_AND_APPROVED_MERGE_PENDING',
 'CURRENT_ACCOUNT_WIDE_PROVIDER_QUOTA_NOT_ATOMICALLY_RESERVED',
 'MODEL_ENTITLEMENT_NOT_INDEPENDENTLY_PROVEN',
 'PRODUCTION_D1_MIGRATION_NOT_APPROVED_OR_APPLIED',
 'INDEPENDENT_WATCHDOG_LIVE_RESTORE_NOT_TESTED',
 'EXTERNAL_DASHBOARD_WRANGLER_RELEASE_EXCLUSION_UNVERIFIED',
 'OWNER_NEW_LIVE_CONSENT_OAUTH_CSRF_NOT_VERIFIED'
]);
export const SIX_CALL_LIVE_BLOCKERS=IMMUTABLE_LIVE_BLOCKERS;

/**
 * Pure read-only aggregator. All source labels and booleans are untrusted,
 * hence a wholly consistent bundle still is NOT production authorization.
 * NEVER accept the result in an inference/deployment release predicate.
 */
export function corroborateSixCallReadOnly({
 worker,d1,github,history,quota,nowMs=Date.now()
}={}){
 if(!stamp(nowMs))return deny('AUDIT_CLOCK_UNVERIFIED');
 const sources={worker,d1,github,history,quota};
 for(const [name,s] of Object.entries(sources)){
  if(!s||typeof s!=='object'||Array.isArray(s)||
      s.status==='BLOCKED'||s.authorizesLiveActions!==false||
      s.authorizesInference===true||s.authorizesDeployment===true)
   return deny('SOURCE_MISSING_BLOCKED_OR_UNTRUSTED_'+name.toUpperCase());
 }
 const clockFields=[
  worker.checkedAtMs,d1.checkedAtMs,github.checkedAtMs,
  history.checkedAt,quota.checkedAtMs
 ];
 if(!clockFields.every(x=>fresh(x,nowMs)))
  return deny('INDEPENDENT_SOURCE_STALE_OR_FUTURE');
 if(Math.max(...clockFields)-Math.min(...clockFields)>TWO_MIN)
  return deny('NONATOMIC_SOURCE_TIME_SPREAD_TOO_LARGE');
 if(worker.source!=='CLOUDFLARE_GET_ONLY_NONATOMIC'||
    worker.status!=='WORKER_AND_WATCHDOG_PARKED_GET_REVIEW_ONLY'||
    worker.accountId!==DISCORD_SMOKE_TARGET.accountId||
    worker.worker!==DISCORD_SMOKE_TARGET.worker||
    worker.baselineVersion!==DISCORD_BASELINE_PIN||
    worker.trafficPercentage!==100||
    typeof worker.deploymentId!=='string'||
    !/^[a-f0-9-]{36}$/i.test(worker.deploymentId)||
    worker.allFourSwarmFlagsOffObserved!==true||
    worker.discordD1BindingObserved!==true||
    worker.watchdog!==DISCORD_WATCHDOG_NAME||
    worker.watchdogArmed!==false||
    worker.watchdogScheduleObserved!==true||
    worker.independentRollbackLiveTested!==false)
  return deny('WORKER_BASELINE_WATCHDOG_NOT_PROVEN_PARKED');
 if(d1.source!=='CLOUDFLARE_D1_SELECT_ONLY'||
    d1.readOnly!==true||d1.status!=='MIGRATION_UNAPPLIED_CONFIRMED'||
    d1.schemaObjectCount!==0||d1.expectedObjectCount!==7||
    d1.counts!==null||d1.sqlDefinitionsVerified!==false||
    d1.originalHistoricalUnknownVerified!==false)
  return deny('D1_MIGRATION_STATE_NOT_UNAPPLIED_OR_UNVERIFIED');
 if(history.source!=='GET_AND_SELECT_ONLY_NONATOMIC_SNAPSHOT'||
    history.status!=='SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN'||
    history.preservedUnknownCount!==1||history.activeJobs!==0||
    history.authorizesCleanupWrites!==false)
  return deny('ORIGINAL_HISTORICAL_UNKNOWN_OR_ACTIVE_JOBS_UNVERIFIED');
 if(github.source!=='GITHUB_API_GET_RUN_COUNTS'||
    github.repository!=='ikkinotako2-sketch/discord-gpt-relay-system'||
    github.status!=='GITHUB_ZERO_ACTIVE_UNMERGED_DRAFTS'||
    github.activeCount!==0||github.mainHeadMatched!==true||
    github.draftPrsMergedInSafeOrder!==false||
    !SHA.test(github.expectedMainSha||'')||
    !SHA.test(github.expectedTopHeadSha||'')||
    !Array.isArray(github.counts)||github.counts.length!==5||
    !github.counts.every(x=>x.activeCount===0))
  return deny('GITHUB_ZERO_RUNS_PINNED_UNMERGED_STACK_NOT_PROVEN');
 if(quota.status!=='REVIEW_ONLY_NUMERIC_MARGIN'||
    quota.capacityReviewOnly!==true||
    quota.realProviderQuotaVerified!==false||
    quota.modelPermissionVerified!==false||
    quota.attempts!==6||
    quota.utcDay!==new Date(nowMs).toISOString().slice(0,10)||
    !(typeof quota.remainingEstimate==='number'&&
      Number.isFinite(quota.remainingEstimate)&&quota.remainingEstimate>=0)||
    !(typeof quota.conservativeCostEstimate==='number'&&
      Number.isFinite(quota.conservativeCostEstimate)&&
      quota.conservativeCostEstimate>0&&
      quota.conservativeCostEstimate<=quota.remainingEstimate))
  return deny('ACCOUNT_WIDE_QUOTA_NUMERIC_REVIEW_UNVERIFIED');
 return Object.freeze({
  status:'CROSS_SOURCE_CONSISTENT_READ_ONLY_NOT_AUTHORIZED',
  checkedAtMs:nowMs,
  sourceCount:clockFields.length,
  snapshotSpreadMs:Math.max(...clockFields)-Math.min(...clockFields),
  target:{...DISCORD_SMOKE_TARGET},
  baselineVersion:DISCORD_BASELINE_PIN,
  historicalUnknownPreserved:true,
  migrationNotApplied:true,
  currentDayQuotaNumericReviewOnly:true,
  githubActiveRunsAtSnapshot:0,
  blockers:IMMUTABLE_LIVE_BLOCKERS,
  nonAtomic:true,independentSourceSignatureValidated:false,
  modelEntitlementValidated:false,liveWatchdogRollbackValidated:false,
  authorizesInference:false,authorizesDeployment:false,
  authorizesMigration:false,authorizesD1Writes:false,
  authorizesWatchdogArming:false,authorizesLiveActions:false
 });
}
