// OFFLINE/read-only account-wide Workers AI Neuron evidence gate.
// NEVER performs a provider request, verifies OAuth, provisions billing,
// infers model entitlement, or authorizes deployment/inference.
// This is deliberately NOT a runtime 'quota OK' or a trusted collector.
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
import {GPT_OSS_MODEL} from '../loop-quality.mjs';

export const WORKERS_AI_FREE_DAILY_NEURONS=10000;
export const WORKERS_AI_FREE_RESET_UTC='00:00';
export const REQUIRED_SIX_ATTEMPTS=6;
const FIVE_MIN=5*60*1000;
const day=ms=>new Date(ms).toISOString().slice(0,10);
const validMs=n=>Number.isSafeInteger(n)&&n>=1e12;
const finiteNonnegative=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const finitePositive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const fail=(reason,detail={})=>Object.freeze({
 status:'BLOCKED',reason,capacityReviewOnly:false,
 realProviderQuotaVerified:false,modelPermissionVerified:false,
 authorizesLiveActions:false,authorizesInference:false,...detail
});
/**
 * A READ-ONLY reviewer can calculate a *necessary* (never sufficient)
 * numeric margin when the Cloudflare dashboard data has been independently
 * reviewed. None of these caller-supplied fields is a cryptographic provider
 * attestation, and the result is always non-authorizing.
 *
 * Worker invocation counts, GraphQL aggregates without an explicit Neuron
 * metric, previous UTC dates, script-only usage and D1 call counts cannot
 * establish an account-wide current-day Neuron balance.
 */
export function reviewWorkersAiFreeQuota({snapshot,nowMs=Date.now(),
 modelId=GPT_OSS_MODEL,attempts=REQUIRED_SIX_ATTEMPTS}={}){
 if(!validMs(nowMs))return fail('CLOCK_UNVERIFIED');
 if(modelId!==GPT_OSS_MODEL||attempts!==REQUIRED_SIX_ATTEMPTS)
  return fail('UNPINNED_MODEL_OR_SIX_ATTEMPT_SCOPE');
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
  return fail('ACCOUNT_WIDE_USAGE_NOT_PROVIDED');
 if(snapshot.accountId!==DISCORD_SMOKE_TARGET.accountId)
  return fail('WRONG_CLOUDFLARE_ACCOUNT');
 if(snapshot.utcDay!==day(nowMs)||!validMs(snapshot.checkedAtMs)||
    snapshot.checkedAtMs>nowMs||nowMs-snapshot.checkedAtMs>FIVE_MIN)
  return fail('TODAY_UTC_ACCOUNT_USAGE_STALE_OR_MISSING');
 if(snapshot.source!=='WORKERS_AI_ACCOUNT_WIDE_DASHBOARD_REVIEW'||
    snapshot.metric!=='NEURONS_USED_ACCOUNT_WIDE'||
    snapshot.coverage!=='ALL_WORKERS_AND_AI_GATEWAY')
  return fail('USAGE_METRIC_OR_ACCOUNT_COVERAGE_UNVERIFIED');
 if(snapshot.accountPlan!=='free'||snapshot.freeDailyAllocation!==WORKERS_AI_FREE_DAILY_NEURONS)
  return fail('FREE_PLAN_OR_LIMIT_UNVERIFIED');
 if(!finiteNonnegative(snapshot.neuronsUsed)||
    snapshot.neuronsUsed>WORKERS_AI_FREE_DAILY_NEURONS)
  return fail('ACCOUNT_WIDE_NEURON_TOTAL_INVALID');
 // A worst-case per-inference estimate must come from a separately verified
 // measurement. This module only evaluates numeric plausibility; it NEVER
 // asserts that a caller's number is correctly measured.
 if(!finitePositive(snapshot.worstCaseNeuronsPerCall)||
    !finiteNonnegative(snapshot.additionalConcurrentNeuronReserve)||
    snapshot.additionalConcurrentNeuronReserve>WORKERS_AI_FREE_DAILY_NEURONS)
  return fail('SIX_CALL_COST_UPPER_BOUND_UNVERIFIED');
 if(snapshot.otherAiWorkersIdle!==true)
  return fail('OTHER_AI_WORKERS_NOT_PROVEN_IDLE');
 if(snapshot.modelPermissionStatus!=='INDEPENDENT_REVIEW_REQUIRED')
  return fail('MODEL_PERMISSION_NOT_INDEPENDENTLY_VERIFIED');
 const remaining=WORKERS_AI_FREE_DAILY_NEURONS-snapshot.neuronsUsed;
 const proposed=attempts*snapshot.worstCaseNeuronsPerCall+
   snapshot.additionalConcurrentNeuronReserve;
 if(!Number.isFinite(proposed)||proposed<=0||proposed>remaining)
  return fail('INSUFFICIENT_CONSERVATIVE_NUMERIC_MARGIN',{
   remainingEstimate:remaining,conservativeCostEstimate:proposed
  });
 return Object.freeze({
  status:'REVIEW_ONLY_NUMERIC_MARGIN',
  capacityReviewOnly:true,
  remainingEstimate:remaining,
  conservativeCostEstimate:proposed,
  checkedAtMs:snapshot.checkedAtMs,utcDay:snapshot.utcDay,
  modelId,attempts,resetTimeUtc:WORKERS_AI_FREE_RESET_UTC,
  realProviderQuotaVerified:false,
  modelPermissionVerified:false,
  authorizesLiveActions:false,authorizesInference:false,
  caveat:'Data freshness and numeric margin are necessary, NOT sufficient; dashboard aggregation may lag or omit other concurrent users.'
 });
}

export function reviewWorkersAiGraphqlNeurons({response,nowMs=Date.now()}={}){
 if(!validMs(nowMs))return fail('CLOCK_UNVERIFIED');
 // Generic Workers-Invocations Adaptive aggregate has no reliable provider
 // Neuron total. An HTTP 200 or yesterday's sum is NOT an account quota.
 if(response?.errors?.length)return fail('GRAPHQL_ERRORS_PRESENT');
 if(response?.data?.viewer?.accounts===undefined)
  return fail('GRAPHQL_ACCOUNT_DATA_MISSING');
 return fail('GRAPHQL_NEURON_BALANCE_UNVERIFIED');
}
