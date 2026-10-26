// OFFLINE-ONLY safety audit packet for the staged six-call release.
// Sources may be read-only Cloudflare/D1/GitHub snapshots from their separate
// collectors. This NEVER turns source-reported booleans into release authority.
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

const validMs=x=>Number.isSafeInteger(x)&&x>=1e12;
const SHA=/^[a-f0-9]{40}$/;
const FIVE_MIN=5*60*1000;
const REQUIRED=Object.freeze([
 'PRODUCTION_D1_MIGRATION_NOT_APPLIED',
 'OWNER_NEW_EXPLICIT_LIVE_APPROVAL_MISSING',
 'CROSS_OPERATOR_RELEASE_FREEZE_NOT_PROVEN',
 'WATCHDOG_LIVE_PREARM_AND_ROLLBACK_NOT_PROVEN',
 'MODEL_ENTITLEMENT_NOT_PROVEN',
 'ACCOUNT_WIDE_REALTIME_QUOTA_NOT_RESERVED'
]);
export const ALWAYS_EXTERNAL_PROOF_REQUIRED=REQUIRED;
const immutable=values=>Object.freeze({...values});
/**
 * Classify evidence for planning/review only. A historical UNKNOWN review
 * and passing offline CI must NOT be converted to live execution permission.
 * No Cloudflare network, D1 mutation, Workflows dispatch, or inference.
 */
export function buildSixCallReadinessReport({
 safeOffAudit,quotaReview,github,codeReview,nowMs=Date.now()
}={}){
 const blockers=[...REQUIRED];
 const requireBlocker=(condition,code)=>{if(!condition&&!blockers.includes(code))blockers.push(code);};
 if(!validMs(nowMs))return immutable({status:'BLOCKED',blockers:[...blockers,'CLOCK_UNVERIFIED'],
   authorizesInference:false,authorizesDeployment:false,authorizesMigration:false});
 requireBlocker(
  safeOffAudit?.source==='GET_AND_SELECT_ONLY_NONATOMIC_SNAPSHOT'&&
   safeOffAudit.status==='SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN'&&
   safeOffAudit.authorizesLiveActions===false&&
   validMs(safeOffAudit.checkedAt)&&safeOffAudit.checkedAt<=nowMs&&
   nowMs-safeOffAudit.checkedAt<=FIVE_MIN,
  'FRESH_INDEPENDENT_BASELINE_D1_WATCHDOG_SAFE_OFF_AUDIT_MISSING'
 );
 requireBlocker(
  quotaReview?.status==='REVIEW_ONLY_NUMERIC_MARGIN'&&
   quotaReview.authorizesInference===false&&
   quotaReview.realProviderQuotaVerified===false&&
   quotaReview.utcDay===new Date(nowMs).toISOString().slice(0,10)&&
   validMs(quotaReview.checkedAtMs)&&quotaReview.checkedAtMs<=nowMs&&
   nowMs-quotaReview.checkedAtMs<=FIVE_MIN,
  'CURRENT_DAY_ACCOUNT_NEURON_NUMERIC_EVIDENCE_MISSING'
 );
 requireBlocker(
  github?.source==='GITHUB_API_GET_RUN_COUNTS'&&
   github.repository==='ikkinotako2-sketch/discord-gpt-relay-system'&&
   Number.isSafeInteger(github.activeCount)&&github.activeCount===0&&
   validMs(github.checkedAtMs)&&github.checkedAtMs<=nowMs&&
   nowMs-github.checkedAtMs<=FIVE_MIN,
  'GITHUB_ACTIVE_WORKFLOW_COUNT_UNVERIFIED'
 );
 requireBlocker(
  SHA.test(codeReview?.currentMainSha||'')&&
   SHA.test(codeReview?.candidateHeadSha||'')&&
   codeReview?.candidateHeadSha===codeReview?.reviewedHeadSha&&
   codeReview?.currentMainSha===codeReview?.reviewedMainSha&&
   codeReview?.offlineCiAllPassing===true&&
   codeReview?.draftPrsMergedInSafeOrder===true,
  'REVIEWED_HEAD_OR_OFFLINE_CI_OR_DEPENDENCY_CHAIN_UNVERIFIED'
 );
 const fields=Object.freeze({
  target:{...DISCORD_SMOKE_TARGET},checkedAtMs:nowMs,
  originalUnknownPreserved:safeOffAudit?.preservedUnknownCount===1,
  currentAccountMarginReviewed:quotaReview?.status==='REVIEW_ONLY_NUMERIC_MARGIN',
  noGithubActions:github?.activeCount===0,
  codeHeadPinned:SHA.test(codeReview?.candidateHeadSha||'')&&
    codeReview.candidateHeadSha===codeReview?.reviewedHeadSha
 });
 // Data comes from independently supplied read-only sources or test fixtures.
 // Even if everything appears ready, all of REQUIRED need real-world proof.
 return immutable({
  status:'BLOCKED_NEEDS_INDEPENDENT_LIVE_REVIEW',
  blockers:Object.freeze(blockers),
  checks:fields,
  nonAtomicReadOnlyEvidence:true,
  signedOwnerApprovalVerified:false,
  realWatchdogRestoreVerified:false,
  accountQuotaReservationVerified:false,
  remoteD1SchemaMigrated:false,
  authorizesInference:false,
  authorizesDeployment:false,
  authorizesMigration:false,
  authorizesWatchdogArming:false,
  authorizesD1Writes:false
 });
}
