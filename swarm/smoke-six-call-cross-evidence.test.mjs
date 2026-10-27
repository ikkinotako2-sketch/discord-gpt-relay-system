import test from 'node:test';
import assert from 'node:assert/strict';
import {corroborateSixCallReadOnly,SIX_CALL_LIVE_BLOCKERS}
 from './smoke-six-call-cross-evidence.mjs';
import {DISCORD_SMOKE_TARGET as T} from './smoke-restore-guard.mjs';
import {DISCORD_BASELINE_PIN,DISCORD_WATCHDOG_NAME}
 from './smoke-six-call-worker-get-audit.mjs';

const now=Date.UTC(2026,9,27,11,20);
const sha='f80530a27ed31fbdb081e482a5f8e5d91d8f32a6';
const deploymentId='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const worker=()=>({
 status:'WORKER_AND_WATCHDOG_PARKED_GET_REVIEW_ONLY',
 source:'CLOUDFLARE_GET_ONLY_NONATOMIC',checkedAtMs:now-12_000,
 accountId:T.accountId,worker:T.worker,
 baselineVersion:DISCORD_BASELINE_PIN,
 deploymentId,trafficPercentage:100,allFourSwarmFlagsOffObserved:true,
 discordD1BindingObserved:true,watchdog:DISCORD_WATCHDOG_NAME,
 watchdogArmed:false,watchdogScheduleObserved:true,
 independentRollbackLiveTested:false,authorizesLiveActions:false,
 authorizesDeployment:false,authorizesInference:false
});
const d1=()=>({
 status:'MIGRATION_UNAPPLIED_CONFIRMED',
 source:'CLOUDFLARE_D1_SELECT_ONLY',checkedAtMs:now-13_000,
 schemaObjectCount:0,expectedObjectCount:11,readOnly:true,counts:null,
 sqlDefinitionsVerified:false,originalHistoricalUnknownVerified:false,
 authorizesLiveActions:false,authorizesD1Writes:false,
 authorizesDeployment:false,authorizesInference:false
});
const github=()=>({
 status:'GITHUB_ZERO_ACTIVE_UNMERGED_DRAFTS',
 source:'GITHUB_API_GET_RUN_COUNTS',checkedAtMs:now-10_000,
 repository:'ikkinotako2-sketch/discord-gpt-relay-system',
 activeCount:0,mainHeadMatched:true,
 draftPrsMergedInSafeOrder:false,
 expectedMainSha:sha,expectedTopHeadSha:sha,
 counts:['queued','in_progress','waiting','pending','requested'].map(status=>({
  status,activeCount:0
 })),
 authorizesLiveActions:false,authorizesDeployment:false,authorizesInference:false
});
const history=()=>({
 status:'SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN',
 source:'GET_AND_SELECT_ONLY_NONATOMIC_SNAPSHOT',checkedAt:now-11_000,
 preservedUnknownCount:1,activeJobs:0,authorizesCleanupWrites:false,
 authorizesLiveActions:false
});
const quota=()=>({
 status:'REVIEW_ONLY_NUMERIC_MARGIN',checkedAtMs:now-11_500,
 capacityReviewOnly:true,realProviderQuotaVerified:false,
 modelPermissionVerified:false,attempts:6,
 utcDay:'2026-10-27',remainingEstimate:9500,
 conservativeCostEstimate:1100,authorizesLiveActions:false,
 authorizesInference:false
});
const defaults=()=>({worker:worker(),d1:d1(),github:github(),
 history:history(),quota:quota(),nowMs:now});
test('consistent independent-shaped reports stay strictly non-authorizing',()=>{
 const r=corroborateSixCallReadOnly(defaults());
 assert.equal(r.status,'CROSS_SOURCE_CONSISTENT_READ_ONLY_NOT_AUTHORIZED');
 assert.equal(r.snapshotSpreadMs,3_000);
 assert.equal(r.sourceCount,5);
 assert.equal(r.historicalUnknownPreserved,true);
 assert.equal(r.migrationNotApplied,true);
 assert.equal(r.authorizesInference,false);
 assert.equal(r.authorizesDeployment,false);
 assert.equal(r.authorizesD1Writes,false);
 assert.equal(r.authorizesWatchdogArming,false);
 assert.equal(r.modelEntitlementValidated,false);
 assert.equal(r.liveWatchdogRollbackValidated,false);
 assert.equal(r.independentSourceSignatureValidated,false);
 assert.deepEqual(r.blockers,SIX_CALL_LIVE_BLOCKERS);
 assert.equal(Object.isFrozen(r.blockers),true);
});
test('no individual absent or blocked source can be replaced with a boolean',()=>{
 for(const key of ['worker','d1','github','history','quota']){
  for(const data of [null,undefined,true,{}, {status:'BLOCKED',authorizesLiveActions:false}]){
   const args=defaults();args[key]=data;
   const r=corroborateSixCallReadOnly(args);
   assert.equal(r.status,'BLOCKED',key);
   assert.equal(r.authorizesInference,false,key);
  }
 }
});
test('stale, future, or non-atomic >2minute source intervals fail closed',()=>{
 for(const key of ['worker','d1','github','quota']){
  for(const timestamp of [now+1,now-6*60*1000,0]){
   const args=defaults();args[key]={...args[key],checkedAtMs:timestamp};
   assert.equal(corroborateSixCallReadOnly(args).status,'BLOCKED');
  }
 }
 const args=defaults();args.history={...args.history,checkedAt:now-3*60*1000};
 assert.equal(corroborateSixCallReadOnly(args).reason,
  'NONATOMIC_SOURCE_TIME_SPREAD_TOO_LARGE');
});
test('clock rollback and invalid timestamps never permit live decisions',()=>{
 for(const n of [null,0,-1,NaN,Infinity]){
  const r=corroborateSixCallReadOnly({...defaults(),nowMs:n});
  assert.equal(r.status,'BLOCKED');assert.equal(r.authorizesLiveActions,false);
 }
});
test('Worker wrong account/name/version/percentage/Watchdog parked blocks',()=>{
 for(const patch of [
  {accountId:'different'}, {worker:'wrong'},
  {baselineVersion:'28c379e8-e759-4b2f-8300-e7a4c8b39b83'},
  {trafficPercentage:50},{watchdogArmed:true},
  {allFourSwarmFlagsOffObserved:false},{discordD1BindingObserved:false},
  {watchdogScheduleObserved:false},{watchdog:'unknown'},
  {independentRollbackLiveTested:true},{deploymentId:'not-uuid'}
 ]){
  const args=defaults();args.worker={...args.worker,...patch};
  assert.equal(corroborateSixCallReadOnly(args).reason,
   'WORKER_BASELINE_WATCHDOG_NOT_PROVEN_PARKED');
 }
});
test('D1 partially applied migration, present schema, or inconsistent evidence blocks',()=>{
 for(const patch of [
  {status:'PARTIAL_D1_CONTROL_MIGRATION_UNSAFE'},
  {status:'MIGRATION_OBJECTS_PRESENT_REVIEW_REQUIRED',schemaObjectCount:11},
  {schemaObjectCount:1},{counts:{runs:0}},
  {sqlDefinitionsVerified:true},{originalHistoricalUnknownVerified:true},
  {readOnly:false},{expectedObjectCount:10}
 ]){
  const args=defaults();args.d1={...args.d1,...patch};
  assert.equal(corroborateSixCallReadOnly(args).reason,
    'D1_MIGRATION_STATE_NOT_UNAPPLIED_OR_UNVERIFIED');
 }
});
test('historic UNKNOWN changed, extra job, or unreviewed source blocks',()=>{
 for(const patch of [
  {preservedUnknownCount:0},{preservedUnknownCount:2},{activeJobs:1},
  {authorizesCleanupWrites:true},{source:'USER_PROVIDED_JSON'},
  {status:'CLEAN'}
 ]){
  const args=defaults();args.history={...args.history,...patch};
  assert.equal(corroborateSixCallReadOnly(args).reason,
   'ORIGINAL_HISTORICAL_UNKNOWN_OR_ACTIVE_JOBS_UNVERIFIED');
 }
});
test('GitHub running job, wrong repo or DRIFT cannot be replaced by zero',()=>{
 for(const patch of [
  {activeCount:1},{status:'GITHUB_ACTIONS_IN_PROGRESS_BLOCKED'},
  {mainHeadMatched:false},{draftPrsMergedInSafeOrder:true},
  {repository:'other/owner'},{counts:[]},
  {counts:github().counts.map((s,i)=>({...s,activeCount:i===1?1:0}))},
  {expectedMainSha:'unknown'}, {expectedTopHeadSha:'not-sha'}
 ]){
  const args=defaults();args.github={...args.github,...patch};
  assert.equal(corroborateSixCallReadOnly(args).reason,
   'GITHUB_ZERO_RUNS_PINNED_UNMERGED_STACK_NOT_PROVEN');
 }
});
test('prior UTC day, wrong attempts, budget shortage or forged model proof blocks',()=>{
 for(const patch of [
  {utcDay:'2026-10-26'},{attempts:7},
  {conservativeCostEstimate:9800},{remainingEstimate:1000},
  {capacityReviewOnly:false},{realProviderQuotaVerified:true},
  {modelPermissionVerified:true},{remainingEstimate:NaN},
  {conservativeCostEstimate:-2}
 ]){
  const args=defaults();args.quota={...args.quota,...patch};
  assert.equal(corroborateSixCallReadOnly(args).reason,
    'ACCOUNT_WIDE_QUOTA_NUMERIC_REVIEW_UNVERIFIED');
 }
});
test('no malicious caller can set approval, rollback or real quota by extra fields',()=>{
 const args=defaults();
 args.ownerConsent=true;args.rollbackProved=true;
 args.authorizesInference=true;args.releaseLockIsGlobal=true;
 args.worker={...args.worker,ownerConsent:true,authorizesDeployment:false};
 const r=corroborateSixCallReadOnly(args);
 assert.equal(r.authorizesLiveActions,false);
 assert.equal(r.authorizesInference,false);
 assert.equal(r.authorizesDeployment,false);
});
test('preserved UNKNOWN is never treated as CLEAN success',()=>{
 const r=corroborateSixCallReadOnly(defaults());
 assert.equal(r.historicalUnknownPreserved,true);
 assert.equal(r.status.includes('AUTHORIZED'),true); // explicit NOT_AUTHORIZED
 assert.equal(r.blockers.includes('OWNER_NEW_LIVE_CONSENT_OAUTH_CSRF_NOT_VERIFIED'),true);
});
test('source authorization true unconditionally poisons the evidence bundle',()=>{
 for(const key of ['worker','d1','github','history','quota']){
  const args=defaults();args[key]={...args[key],authorizesLiveActions:true};
  assert.equal(corroborateSixCallReadOnly(args).status,'BLOCKED');
 }
});
