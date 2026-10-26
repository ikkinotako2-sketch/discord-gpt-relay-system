import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSixCallReadinessReport,ALWAYS_EXTERNAL_PROOF_REQUIRED}
 from './smoke-six-call-readiness-report.mjs';
import {reviewWorkersAiFreeQuota} from './smoke-six-call-free-neuron-review.mjs';
import {DISCORD_SMOKE_TARGET as T} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,26,12,0);
const sha='500fbbd7aba025b6990b25ce2d097e550769f738';
const safeOff=()=>({
 status:'SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN',
 source:'GET_AND_SELECT_ONLY_NONATOMIC_SNAPSHOT',
 authorizesLiveActions:false,checkedAt:now,
 preservedUnknownCount:1
});
const quota=()=>reviewWorkersAiFreeQuota({
 nowMs:now,snapshot:{
 accountId:T.accountId,utcDay:'2026-10-26',checkedAtMs:now,
 source:'WORKERS_AI_ACCOUNT_WIDE_DASHBOARD_REVIEW',
 metric:'NEURONS_USED_ACCOUNT_WIDE',coverage:'ALL_WORKERS_AND_AI_GATEWAY',
 accountPlan:'free',freeDailyAllocation:10000,
 neuronsUsed:150,worstCaseNeuronsPerCall:100,
 additionalConcurrentNeuronReserve:100,otherAiWorkersIdle:true,
 modelPermissionStatus:'INDEPENDENT_REVIEW_REQUIRED'
 }});
const github=()=>({source:'GITHUB_API_GET_RUN_COUNTS',
 repository:'ikkinotako2-sketch/discord-gpt-relay-system',
 activeCount:0,checkedAtMs:now});
const code=()=>({currentMainSha:sha,candidateHeadSha:sha,
 reviewedHeadSha:sha,reviewedMainSha:sha,
 offlineCiAllPassing:true,draftPrsMergedInSafeOrder:true});
const evaluate=(changes={})=>buildSixCallReadinessReport({
 safeOffAudit:safeOff(),quotaReview:quota(),github:github(),
 codeReview:code(),nowMs:now,...changes
});
test('even all MOCK green inputs never return deploy/model authorization',()=>{
 const r=evaluate();
 assert.equal(r.status,'BLOCKED_NEEDS_INDEPENDENT_LIVE_REVIEW');
 assert.equal(r.authorizesInference,false);
 assert.equal(r.authorizesDeployment,false);
 assert.equal(r.authorizesMigration,false);
 assert.equal(r.authorizesWatchdogArming,false);
 assert.equal(r.authorizesD1Writes,false);
 assert.equal(r.signedOwnerApprovalVerified,false);
 assert.equal(r.realWatchdogRestoreVerified,false);
 assert.equal(r.accountQuotaReservationVerified,false);
 assert.equal(r.blockers.length,ALWAYS_EXTERNAL_PROOF_REQUIRED.length);
});
test('actual October 2026 historical UNKNOWN safe OFF read is not launch permission',()=>{
 const r=evaluate();assert.equal(r.checks.originalUnknownPreserved,true);
 assert.equal(r.nonAtomicReadOnlyEvidence,true);
 assert.ok(r.blockers.includes('OWNER_NEW_EXPLICIT_LIVE_APPROVAL_MISSING'));
});
test('safe-off snapshot absent/stale or wrong source blocks extra',()=>{
 for(const p of [
  null,{...safeOff(),source:'MOCK'},
  {...safeOff(),checkedAt:now-6*60*1000},
  {...safeOff(),checkedAt:now+1},
  {...safeOff(),status:'UNKNOWN'},
  {...safeOff(),authorizesLiveActions:true}
 ]){
  assert.ok(evaluate({safeOffAudit:p}).blockers.includes(
    'FRESH_INDEPENDENT_BASELINE_D1_WATCHDOG_SAFE_OFF_AUDIT_MISSING'));
 }
});
test('prior-day quota, NULL GraphQL metric and fake approved quota cannot pass',()=>{
 for(const q of [null,{status:'BLOCKED'},
  {...quota(),utcDay:'2026-10-25'},
  {...quota(),checkedAtMs:now-6*60*1000},
  {...quota(),authorizesInference:true},
  {...quota(),realProviderQuotaVerified:true}
 ]){
  assert.ok(evaluate({quotaReview:q}).blockers.includes(
    'CURRENT_DAY_ACCOUNT_NEURON_NUMERIC_EVIDENCE_MISSING'));
 }
});
test('GitHub in-progress run, bad source, malformed clock and stale count block',()=>{
 for(const git of [null,{...github(),activeCount:1},
  {...github(),checkedAtMs:now-6*60*1000},
  {...github(),source:'REQUEST_JSON'},
  {...github(),repository:'foreign/repo'},
  {...github(),activeCount:'0'}
 ]){
  assert.ok(evaluate({github:git}).blockers.includes(
    'GITHUB_ACTIVE_WORKFLOW_COUNT_UNVERIFIED'));
 }
});
test('unmerged dependency, wrong pinned HEAD or failed CI blocks review',()=>{
 for(const rev of [null,
  {...code(),draftPrsMergedInSafeOrder:false},
  {...code(),reviewedHeadSha:'a'.repeat(40)},
  {...code(),reviewedMainSha:'a'.repeat(40)},
  {...code(),candidateHeadSha:'unverified'},
  {...code(),offlineCiAllPassing:false}
 ]){
  assert.ok(evaluate({codeReview:rev}).blockers.includes(
    'REVIEWED_HEAD_OR_OFFLINE_CI_OR_DEPENDENCY_CHAIN_UNVERIFIED'));
 }
});
test('real project Draft chain fails merge readiness even with green CI',()=>{
 const r=evaluate({codeReview:{...code(),draftPrsMergedInSafeOrder:false}});
 assert.equal(r.status,'BLOCKED_NEEDS_INDEPENDENT_LIVE_REVIEW');
 assert.equal(r.authorizesInference,false);
});
test('clock invalid blocks without incorrectly declaring safe',()=>{
 const r=evaluate({nowMs:10});
 assert.equal(r.status,'BLOCKED');assert.equal(r.authorizesInference,false);
 assert.ok(r.blockers.includes('CLOCK_UNVERIFIED'));
});
test('malicious user booleans cannot promote to inference permission',()=>{
 const r=evaluate({signedOwnerApprovalVerified:true,
  releaseSerializationHeld:true,modelPermissionVerified:true,
  authorizesInference:true,authorizesDeployment:true});
 assert.equal(r.authorizesInference,false);assert.equal(r.authorizesDeployment,false);
});
test('missing snapshots and empty objects still return actionable blockers',()=>{
 const r=buildSixCallReadinessReport({nowMs:now});
 assert.equal(r.status,'BLOCKED_NEEDS_INDEPENDENT_LIVE_REVIEW');
 assert.ok(r.blockers.length>ALWAYS_EXTERNAL_PROOF_REQUIRED.length);
 assert.equal(r.authorizesInference,false);
});
test('protected blocker list does not get rewritten by caller',()=>{
 const r=evaluate();assert.equal(Object.isFrozen(r.blockers),true);
 assert.equal(Object.isFrozen(ALWAYS_EXTERNAL_PROOF_REQUIRED),true);
});
