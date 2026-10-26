import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewWorkersAiFreeQuota,reviewWorkersAiGraphqlNeurons,
 WORKERS_AI_FREE_DAILY_NEURONS} from './smoke-six-call-free-neuron-review.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
import {GPT_OSS_MODEL} from '../loop-quality.mjs';

const now=Date.UTC(2026,9,26,13,0,0);
const snapshot=()=>({
 accountId:DISCORD_SMOKE_TARGET.accountId,
 utcDay:'2026-10-26',checkedAtMs:now,
 source:'WORKERS_AI_ACCOUNT_WIDE_DASHBOARD_REVIEW',
 metric:'NEURONS_USED_ACCOUNT_WIDE',
 coverage:'ALL_WORKERS_AND_AI_GATEWAY',
 accountPlan:'free',freeDailyAllocation:10000,
 neuronsUsed:420.5,worstCaseNeuronsPerCall:200,
 additionalConcurrentNeuronReserve:120,otherAiWorkersIdle:true,
 modelPermissionStatus:'INDEPENDENT_REVIEW_REQUIRED'
});
const run=(change={},opts={})=>reviewWorkersAiFreeQuota({
 snapshot:{...snapshot(),...change},nowMs:now,
 modelId:GPT_OSS_MODEL,...opts
});
test('numerically plausible six-call Free margin is explicitly NOT authorization',()=>{
 const x=run();
 assert.equal(x.status,'REVIEW_ONLY_NUMERIC_MARGIN');
 assert.equal(x.remainingEstimate,9579.5);
 assert.equal(x.conservativeCostEstimate,1320);
 assert.equal(x.realProviderQuotaVerified,false);
 assert.equal(x.modelPermissionVerified,false);
 assert.equal(x.authorizesLiveActions,false);
 assert.equal(x.authorizesInference,false);
});
test('Cloudflare free day allocation and UTC reset are not account proof',()=>{
 assert.equal(WORKERS_AI_FREE_DAILY_NEURONS,10000);
 for(const field of [
  {source:'GRAPHQL_WORKERS_REQUESTS'},
  {source:'CLOUDFLARE_GRAPHQL_PRIOR_DAY'},
  {metric:'INVOCATIONS_ADAPTIVE_SUM'},
  {metric:'REQUESTS'},
  {metric:'NEURON_TOTAL_MISSING'},
  {coverage:'ONLY_DISCORD_WORKER'},
  {coverage:'UNKNOWN'}
 ])assert.equal(run(field).status,'BLOCKED');
});
test('yesterday/tomorrow UTC day and stale dashboard timestamps block',()=>{
 for(const patch of [
  {utcDay:'2026-10-25'},{utcDay:'2026-10-27'},
  {checkedAtMs:now-6*60*1000},{checkedAtMs:now+1},
  {checkedAtMs:null},{checkedAtMs:0}
 ])assert.equal(run(patch).status,'BLOCKED');
});
test('account mismatch, no plan confirmation, quota confusion fail closed',()=>{
 for(const patch of [
  {accountId:'another_account'},{accountPlan:'paid'},
  {accountPlan:null},{freeDailyAllocation:100000},
  {freeDailyAllocation:null},{freeDailyAllocation:undefined}
 ])assert.equal(run(patch).status,'BLOCKED');
});
test('null, missing, NaN, negative and overflowing Neuron totals block',()=>{
 for(const patch of [
  {neuronsUsed:null},{neuronsUsed:undefined},{neuronsUsed:NaN},
  {neuronsUsed:-1},{neuronsUsed:Infinity},{neuronsUsed:10001},
  {worstCaseNeuronsPerCall:0},{worstCaseNeuronsPerCall:null},
  {worstCaseNeuronsPerCall:Infinity},
  {additionalConcurrentNeuronReserve:-1},
  {additionalConcurrentNeuronReserve:NaN},
  {additionalConcurrentNeuronReserve:10001}
 ])assert.equal(run(patch).status,'BLOCKED');
});
test('insufficient worst-case six-call margin is blocked',()=>{
 for(const patch of [
  {neuronsUsed:9999,worstCaseNeuronsPerCall:1},
  {neuronsUsed:9900,worstCaseNeuronsPerCall:20},
  {neuronsUsed:9500,worstCaseNeuronsPerCall:100},
  {worstCaseNeuronsPerCall:2000}
 ])assert.equal(run(patch).reason,'INSUFFICIENT_CONSERVATIVE_NUMERIC_MARGIN');
});
test('other Workers AI workloads and model permission ambiguity block',()=>{
 assert.equal(run({otherAiWorkersIdle:false}).status,'BLOCKED');
 assert.equal(run({otherAiWorkersIdle:undefined}).status,'BLOCKED');
 assert.equal(run({modelPermissionStatus:'MODEL_AVAILABLE'}).status,'BLOCKED');
 assert.equal(run({modelPermissionStatus:undefined}).status,'BLOCKED');
});
test('attempt count never generalizes outside exact six + pinned GPT-OSS',()=>{
 assert.equal(run({}, {attempts:7}).status,'BLOCKED');
 assert.equal(run({}, {attempts:1}).status,'BLOCKED');
 assert.equal(run({}, {modelId:'@cf/other'}).status,'BLOCKED');
});
test('an HTTP 200 GraphQL object with missing Neuron metric does not imply quota',()=>{
 const x=reviewWorkersAiGraphqlNeurons({
 response:{data:{viewer:{accounts:[{workersInvocationsAdaptive:[{
 sum:{requests:100000,cpuTimeUs:10000}
 }]}]}}},nowMs:now
 });
 assert.equal(x.status,'BLOCKED');
 assert.equal(x.reason,'GRAPHQL_NEURON_BALANCE_UNVERIFIED');
 assert.equal(x.authorizesInference,false);
});
test('GraphQL errors, incomplete account data and prior-day sums never authorize',()=>{
 for(const response of [
  {errors:[{message:'forbidden'}]},
  {data:{}},{data:{viewer:{}}},
  {data:{viewer:{accounts:[{priorDayNeuronSum:13.52}]}}}
 ]){
  assert.equal(reviewWorkersAiGraphqlNeurons({response,nowMs:now}).status,'BLOCKED');
 }
});
test('no caller-supplied model entitlement or numeric review can turn it live',()=>{
 const x=run({verified:true,authorizesLiveActions:true,modelAccessVerified:true,
  ownerConsentVerified:true});
 assert.equal(x.authorizesLiveActions,false);
 assert.equal(x.realProviderQuotaVerified,false);
});
test('a numeric margin at exactly zero does not permit an inference',()=>{
 assert.equal(run({neuronsUsed:10000}).status,'BLOCKED');
});
