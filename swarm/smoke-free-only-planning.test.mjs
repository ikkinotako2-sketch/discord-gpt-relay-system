import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 estimateSixCallFreeBudget,reviewFreeOnlyAccountSnapshot,
 SIX_CALL_FREE_PRICING
} from './smoke-free-only-planning.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,27,12,0);
const day='2026-10-27';
const quota=()=>({
 accountId:DISCORD_SMOKE_TARGET.accountId,utcDay:day,checkedAtMs:now,
 plan:'free',paidUsageAllowed:false,prepaidGatewayCreditsAllowed:false,
 source:'OWNER_REVIEWED_CLOUDFLARE_WORKERS_AI_DASHBOARD',
 neuronsUsedAccountWide:100,otherAiIdle:true,modelEntitlementVerifiedByOwner:true
});
const estimate=(p={})=>estimateSixCallFreeBudget({inputTokensPerCall:8192,...p});
const check=(p={},n=1300)=>reviewFreeOnlyAccountSnapshot({
 nowMs:now,snapshot:{...quota(),...p},conservativeSixCallNeurons:n
});
test('2026 Cloudflare public pricing exact model and Free allowance pinned',()=>{
 assert.equal(SIX_CALL_FREE_PRICING.model,'@cf/openai/gpt-oss-20b');
 assert.equal(SIX_CALL_FREE_PRICING.freeDailyAccountNeurons,10000);
 assert.equal(SIX_CALL_FREE_PRICING.neuronPerMillionInput,18182);
 assert.equal(SIX_CALL_FREE_PRICING.neuronPerMillionOutput,27273);
 assert.equal(SIX_CALL_FREE_PRICING.runnerMaxOutputTokensPerCall,360);
 assert.equal(SIX_CALL_FREE_PRICING.attempts,6);
});
test('exact conservative six-call planning calculation never certifies balance',()=>{
 const e=estimate();
 assert.equal(e.status,'HYPOTHETICAL_FREE_PLAN_NUMERIC_FIT_NOT_AUTHORIZED');
 assert.equal(e.computedSixCallNeurons,
  Number((6*(8192*18182+360*2*27273)/1000000).toFixed(6)));
 for(const key of ['actualInputTokensAttested','providerReasoningBillingVerified',
  'accountWideUsageVerified','providerModelEntitlementVerified',
  'providerQuotaReserved','isActualBalance','guaranteesNoCharge',
  'authorizesLiveActions','authorizesInference','authorizesDeployment'])
  assert.equal(e[key],false,key);
});
test('wrong model, 7 calls, oversized token and invalid reserve always block',()=>{
 for(const patch of [
  {model:'@cf/other/model'}, {attempts:5}, {attempts:7},
  {inputTokensPerCall:0}, {inputTokensPerCall:-1},
  {inputTokensPerCall:128001}, {inputTokensPerCall:'8192'},
  {outputTokensPerCall:361},{outputTokensPerCall:0},
  {outputOverheadFactor:0},{outputOverheadFactor:9},
  {additionalAccountReserveNeurons:10001},
  {additionalAccountReserveNeurons:NaN}
 ]) assert.equal(estimate(patch).status,'BLOCKED');
});
test('large hypothetical workload does not claim free budget',()=>{
 const e=estimate({inputTokensPerCall:128000,
  outputTokensPerCall:360,outputOverheadFactor:8,
  additionalAccountReserveNeurons:1});
 assert.equal(e.status,'BLOCKED');
 assert.equal(e.authorizesInference,false);
});
test('no plan upgrade, no paid credits and no cross-day source allowed',()=>{
 for(const patch of [
  {plan:'paid'},{paidUsageAllowed:true},
  {prepaidGatewayCreditsAllowed:true},{plan:undefined},
  {accountId:'foreign_account'}, {utcDay:'2026-10-26'},
  {checkedAtMs:now+1},{checkedAtMs:now-300001},
  {source:'UNTRUSTED_USER_JSON'}
 ]) assert.equal(check(patch).status,'BLOCKED');
});
test('free usage numerical fit still never authorizes live AI or billing',()=>{
 const e=check();
 assert.equal(e.status,'FREE_ONLY_OWNER_SNAPSHOT_REVIEW_NOT_AUTHORIZATION');
 assert.equal(e.nominalUnspentNeurons,9900);
 assert.equal(e.hypotheticalAfterSix,8600);
 assert.equal(e.guaranteesNoCharge,false);
 assert.equal(e.accountWideUsageReserved,false);
 assert.equal(e.authorizesInference,false);
});
test('insufficient quota, active other models or absent entitlement block',()=>{
 for(const patch of [
  {neuronsUsedAccountWide:9999},{neuronsUsedAccountWide:null},
  {neuronsUsedAccountWide:-1},{neuronsUsedAccountWide:10001},
  {otherAiIdle:false},{otherAiIdle:undefined},
  {modelEntitlementVerifiedByOwner:false}
 ]) assert.equal(check(patch).status,'BLOCKED');
});
test('caller approval booleans cannot upgrade model or run permission',()=>{
 const e=check({authorizesInference:true,plan:'free',
  ownerApproved:true,modelEntitlementVerifiedByOwner:true});
 assert.equal(e.authorizesInference,false);
 assert.equal(e.authorizesDeployment,false);
 assert.equal(e.isActualBalance,false);
});
test('runner still has one model request with max_tokens 360 and no paid path',()=>{
 const source=readFileSync(new URL('./runner.mjs',import.meta.url),'utf8');
 assert.match(source,/max_tokens:360/);
 assert.match(source,/budgetCheck/);
 assert.match(source,/MODEL_OUTCOME_UNKNOWN/);
 assert.doesNotMatch(source,/prepaid|paid[ -]?override|ai.gateway|creditBalance/i);
});
test('Free calculator remains pure without network, D1 or billing access',()=>{
 const s=readFileSync(new URL('./smoke-free-only-planning.mjs',import.meta.url),'utf8');
 for(const str of ['fetch(','.run(','.prepare(','process.env','wrangler',
  'BILLING_WRITE','secrets.','stripe.']){
  assert.equal(s.includes(str),false,str);
 }
});
