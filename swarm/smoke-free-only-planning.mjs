// OFFLINE Free-plan calculation and external-proof boundary.
// Pinned to Cloudflare Workers AI 2026-10-01 pricing for
// @cf/openai/gpt-oss-20b (18,182 input / 27,273 output Neurons per M tokens).
// This module performs NO Workers AI request, token read, billing or D1 write.
// All numerical outputs are NON-AUTHORIZING planning estimates.
import {GPT_OSS_MODEL} from '../loop-quality.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

export const SIX_CALL_FREE_PRICING=Object.freeze({
 model:GPT_OSS_MODEL,
 freeDailyAccountNeurons:10000,
 neuronPerMillionInput:18182,
 neuronPerMillionOutput:27273,
 attempts:6,
 runnerMaxOutputTokensPerCall:360,
 reset:'00:00 UTC',
 source:'https://developers.cloudflare.com/workers-ai/platform/pricing/',
 sourceReviewedUtcDay:'2026-10-27'
});
const valid=n=>Number.isSafeInteger(n)&&n>=0;
const validMs=n=>Number.isSafeInteger(n)&&n>=1e12;
const fail=reason=>Object.freeze({
 status:'BLOCKED',reason,isActualBalance:false,
 guaranteesNoCharge:false,authorizesLiveActions:false,
 authorizesInference:false,authorizesDeployment:false
});
/**
 * Numerically evaluate a *hypothetical* six-call workload and an explicit
 * worst-case extra output-token multiplier (reasoning and unknown overhead).
 * The input-token cap must be attested by a real, server-side tokenizer before
 * use. None of the values establishes a provider-billed Neuron upper bound.
 */
export function estimateSixCallFreeBudget({
 model=GPT_OSS_MODEL,attempts=6,
 inputTokensPerCall,outputTokensPerCall=360,
 outputOverheadFactor=2,additionalAccountReserveNeurons=0
}={}){
 if(model!==GPT_OSS_MODEL||attempts!==6||
    !valid(inputTokensPerCall)||inputTokensPerCall===0||inputTokensPerCall>128000||
    !valid(outputTokensPerCall)||outputTokensPerCall===0||
    outputTokensPerCall>360||!valid(outputOverheadFactor)||
    outputOverheadFactor<1||outputOverheadFactor>8||
    !valid(additionalAccountReserveNeurons)||
    additionalAccountReserveNeurons>10000)
  return fail('UNPINNED_MODEL_OR_HYPOTHETICAL_BOUNDS');
 const inputPart=attempts*inputTokensPerCall*
   SIX_CALL_FREE_PRICING.neuronPerMillionInput/1000000;
 const outputPart=attempts*outputTokensPerCall*outputOverheadFactor*
   SIX_CALL_FREE_PRICING.neuronPerMillionOutput/1000000;
 const total=inputPart+outputPart+additionalAccountReserveNeurons;
 if(!Number.isFinite(total)||total>=10000)
  return fail('HYPOTHETICAL_COST_AT_OR_OVER_FREE_ALLOCATION');
 return Object.freeze({
  status:'HYPOTHETICAL_FREE_PLAN_NUMERIC_FIT_NOT_AUTHORIZED',
  model,attempts,
  inputTokensPerCall,outputTokensPerCall,outputOverheadFactor,
  computedSixCallNeurons:Number((inputPart+outputPart).toFixed(6)),
  additionalAccountReserveNeurons,
  hypotheticalAccountFreeMargin:Number((10000-total).toFixed(6)),
  actualInputTokensAttested:false,
  providerReasoningBillingVerified:false,
  accountWideUsageVerified:false,
  providerModelEntitlementVerified:false,
  providerQuotaReserved:false,
  billingPlanVerified:false,
  isActualBalance:false,guaranteesNoCharge:false,
  authorizesLiveActions:false,authorizesInference:false,
  authorizesDeployment:false
 });
}
/**
 * A separate snapshot can show whether human review is stale or structurally
 * invalid, but this does not sign/attest the snapshot or reserve provider quota.
 * It is intentionally impossible for this function to grant runtime authority.
 */
export function reviewFreeOnlyAccountSnapshot({
 snapshot,nowMs=Date.now(),conservativeSixCallNeurons
}={}){
 if(!validMs(nowMs))return fail('CLOCK_UNVERIFIED');
 if(!snapshot||snapshot.accountId!==DISCORD_SMOKE_TARGET.accountId||
    snapshot.utcDay!==new Date(nowMs).toISOString().slice(0,10)||
    !validMs(snapshot.checkedAtMs)||snapshot.checkedAtMs>nowMs||
    nowMs-snapshot.checkedAtMs>5*60*1000)
  return fail('ACCOUNT_DAY_OR_FRESHNESS_UNVERIFIED');
 if(snapshot.plan!=='free'||snapshot.paidUsageAllowed!==false||
    snapshot.prepaidGatewayCreditsAllowed!==false)
  return fail('NO_PAID_SPEND_POLICY_UNVERIFIED');
 if(snapshot.source!=='OWNER_REVIEWED_CLOUDFLARE_WORKERS_AI_DASHBOARD'||
    !Number.isFinite(snapshot.neuronsUsedAccountWide)||
    snapshot.neuronsUsedAccountWide<0||
    snapshot.neuronsUsedAccountWide>10000)
  return fail('ACCOUNT_WIDE_NEURON_METRIC_UNVERIFIED');
 if(!Number.isFinite(conservativeSixCallNeurons)||
    conservativeSixCallNeurons<=0||
    snapshot.neuronsUsedAccountWide+conservativeSixCallNeurons>=10000)
  return fail('FREE_ALLOCATION_MARGIN_NOT_PROVEN_NUMERICALLY');
 if(snapshot.otherAiIdle!==true||
    snapshot.modelEntitlementVerifiedByOwner!==true)
  return fail('UNRELATED_AI_OR_MODEL_ENTITLEMENT_UNVERIFIED');
 return Object.freeze({
  status:'FREE_ONLY_OWNER_SNAPSHOT_REVIEW_NOT_AUTHORIZATION',
  day:snapshot.utcDay,
  nominalUnspentNeurons:Number((10000-snapshot.neuronsUsedAccountWide).toFixed(4)),
  hypotheticalAfterSix:Number(
    (10000-snapshot.neuronsUsedAccountWide-conservativeSixCallNeurons).toFixed(4)),
  originalSnapshotCryptographicallyVerified:false,
  accountWideUsageReserved:false,
  liveIndependentWatchdogVerified:false,
  ownerReleaseAuthorizationVerified:false,
  billingPlanVerified:false,
  isActualBalance:false,guaranteesNoCharge:false,
  authorizesLiveActions:false,authorizesInference:false,
  authorizesDeployment:false
 });
}
