import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSixCallCandidate,runSixCallStep,validLiveStepEvidence,SMOKE_ATTEMPT_LIMIT}
 from './smoke-six-call-controller.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,26,4);
const version1='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const version2='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const candidate=()=>makeSixCallCandidate({runId:'smoke_20261026_test',
 taskReceiptId:'oauth_task_receipt_20261026',baselineVersion:version1,
 smokeVersion:version2,nowMs:now,expiresAtMs:now+19*60*1000});
function memoryStore(){
 let state={...candidate(),phase:'ACTIVE'};
 let claims=0;
 return {
  get current(){return state;},get claims(){return claims;},
  async read(){return {...state};},
  async claimOnce({runId,expectedRevision,index,expectedExpiryMs,nowMs,localDailyCap}){
   if(runId!==state.runId||state.phase!=='ACTIVE'||state.revision!==expectedRevision||
    index!==state.attempts||state.inFlightIndex!==null||
    nowMs>=state.expiresAtMs||expectedExpiryMs!==state.expiresAtMs||
    localDailyCap!==6||state.attempts>=6)return {claimed:false};
   claims++;
   state={...state,revision:state.revision+1,attempts:state.attempts+1,inFlightIndex:index};
   return {...state,claimed:true,index};
  },
  async finishOnce({runId,index,expectedClaimRevision,outcome}){
   if(runId!==state.runId||state.revision!==expectedClaimRevision||
     state.inFlightIndex!==index)throw Error('CAS_CONFLICT');
   state={...state,revision:state.revision+1,inFlightIndex:null,
    completed:state.completed+(outcome==='FINAL_VERIFIED'?1:0),
    phase:outcome==='UNKNOWN'||state.attempts===6?'RESTORE_REQUIRED':'ACTIVE'};
   return {...state};
  }
 };
}
function evidence(s){return {
 status:'VERIFIED_FROM_TRUSTED_ADAPTER',checkedAtMs:now,
 target:DISCORD_SMOKE_TARGET,runId:s.runId,taskReceiptId:s.taskReceiptId,
 baselineVersion:s.baselineVersion,activeVersion:s.smokeVersion,expiresAtMs:s.expiresAtMs,
 ownerOauthCsrfVerified:true,newExplicitOwnerConsentVerified:true,
 watchdogIndependentlyPrearmed:true,watchdogLiveRestoreTested:true,
 releaseLockFencingVerified:true,remoteFourFlagsEnabledAndBounded:true,
 d1HistoryUnknownExactlyPreserved:true,legacyActiveJobs:0,otherSixRoleJobs:0,
 pendingStopJobs:0,accountPlanFreeVerified:true,modelAvailableVerified:true,
 accountWideSixCallsFreeMarginVerified:true,unrelatedAiIdleVerified:true,
 githubActiveReleaseRuns:0,emergencyStopReachable:true
};}
function fixture({advanceClock=0,store=memoryStore(),mutateEvidence=x=>x,invoke}={}){
 let calls=0;
 const provider={async invoke(x){calls++;return invoke?invoke(x):{status:'FINAL_VERIFIED',stageIndex:x.stageIndex,receiptId:'provider_receipt_123'};}};
 const dependencies={store,liveEvidence:{collect:async()=>mutateEvidence(evidence(store.current))},
  provider,clock:()=>now+advanceClock};
 return {...dependencies,get calls(){return calls;}};
}
test('draft candidate cannot become active just by construction',()=>{
 const s=candidate();assert.equal(s.phase,'PENDING_EXTERNAL_ACTIVATION');
 assert.equal(s.authorizesInference,false);assert.equal(s.authorizesDeployment,false);
});
test('invalid scope, stale/long window and same version fail closed',()=>{
 const base={runId:'smoke_20261026_test',taskReceiptId:'oauth_task_receipt_20261026',
  baselineVersion:version1,smokeVersion:version2,nowMs:now,expiresAtMs:now+12000};
 for(const patch of [{runId:'x'},{taskReceiptId:'x'},
   {baselineVersion:version2},{expiresAtMs:now+21*60*1000},
   {expiresAtMs:now-1},{nowMs:-1}]){
  assert.equal(makeSixCallCandidate({...base,...patch}).status,'BLOCKED');
 }
});
test('single-step invocations stop exactly at six; 7th denied before provider',async()=>{
 const f=fixture();let result;
 for(let i=0;i<6;i++){
  result=await runSixCallStep(f);
  assert.equal(result.attempts,i+1);
  assert.equal(result.completed,i+1);
 }
 assert.equal(result.status,'SIX_CALL_LIMIT_REACHED');
 assert.equal(f.calls,6);assert.equal(f.store.claims,6);
 result=await runSixCallStep(f);
 assert.equal(result.status,'BLOCKED');assert.equal(f.calls,6);
});
test('cannot run without separate live adapters or activation',async()=>{
 assert.equal((await runSixCallStep()).reason,'REQUIRED_TRUSTED_ADAPTERS_MISSING');
 const f=fixture(); f.store.current.phase='ACTIVE';
 const original=f.store.read;
 f.store.read=async()=>candidate();
 assert.equal((await runSixCallStep(f)).reason,'NOT_ACTIVE_INVALID_OR_EXPIRED');
 f.store.read=original;
});
test('missing each live gate blocks without a reservation or provider call',async()=>{
 const f=fixture();
 const fields=['ownerOauthCsrfVerified','newExplicitOwnerConsentVerified',
  'watchdogIndependentlyPrearmed','watchdogLiveRestoreTested',
  'releaseLockFencingVerified','remoteFourFlagsEnabledAndBounded',
  'd1HistoryUnknownExactlyPreserved','accountPlanFreeVerified',
  'modelAvailableVerified','accountWideSixCallsFreeMarginVerified',
  'unrelatedAiIdleVerified','emergencyStopReachable'];
 for(const key of fields){
  const r=await runSixCallStep({...f,liveEvidence:{collect:async()=>({...evidence(f.store.current),[key]:false})}});
  assert.equal(r.reason,'LIVE_GATES_NOT_VERIFIED',key);
 }
 assert.equal(f.calls,0);assert.equal(f.store.claims,0);
});
test('wrong resource, stale clock, invalid counters or changed owner receipt block',async()=>{
 const f=fixture();
 for(const patch of [
  {target:{...DISCORD_SMOKE_TARGET,worker:'other'}},
  {checkedAtMs:now-6*60*1000},{runId:'wrong_run'},
  {otherSixRoleJobs:1},{legacyActiveJobs:1},{pendingStopJobs:1},
  {githubActiveReleaseRuns:1},{expiresAtMs:now+10},
  {taskReceiptId:'wrong'}, {status:'VERIFIED'},
 ]){
  const r=await runSixCallStep({...f,liveEvidence:{collect:async()=>({...evidence(f.store.current),...patch})}});
  assert.equal(r.status,'BLOCKED');
 }
 assert.equal(f.calls,0);
});
test('unknown provider outcome consumes claim and never retries',async()=>{
 const f=fixture({invoke:()=>{throw Error('network timeout')}});
 const r=await runSixCallStep(f);
 assert.equal(r.status,'UNKNOWN_STOP');assert.equal(r.attempts,1);
 assert.equal(r.completed,0);assert.equal(f.calls,1);
 assert.equal((await runSixCallStep(f)).status,'BLOCKED');assert.equal(f.calls,1);
});
test('response missing verification is UNKNOWN and stays terminal',async()=>{
 const f=fixture({invoke:()=>({status:'FINAL_VERIFIED',stageIndex:3,receiptId:'x'})});
 assert.equal((await runSixCallStep(f)).status,'UNKNOWN_STOP');
 assert.equal(f.store.claims,1);assert.equal(f.calls,1);
});
test('CAS conflict, network evidence failure and uncertain claim never invoke',async()=>{
 const f=fixture();
 let r=await runSixCallStep({...f,liveEvidence:{collect:async()=>{throw Error('offline')}}});
 assert.equal(r.reason,'LIVE_EVIDENCE_UNAVAILABLE');
 r=await runSixCallStep({...f,store:{...f.store,claimOnce:async()=>({claimed:false})}});
 assert.equal(r.reason,'ATOMIC_CLAIM_UNVERIFIED_DO_NOT_RETRY');
 r=await runSixCallStep({...f,store:{...f.store,claimOnce:async()=>{throw Error('timeout')}}});
 assert.equal(r.reason,'DURABLE_CLAIM_OUTCOME_UNKNOWN_DO_NOT_RETRY');
 assert.equal(f.calls,0);
});
test('settlement failure does not re-invoke an in-flight attempt',async()=>{
 const f=fixture();const original=f.store.finishOnce;
 f.store.finishOnce=async()=>{throw Error('db timeout')};
 assert.equal((await runSixCallStep(f)).reason,'SETTLEMENT_UNCERTAIN_DO_NOT_RETRY');
 f.store.finishOnce=original;
 assert.equal((await runSixCallStep(f)).status,'BLOCKED');
 assert.equal(f.calls,1);
});
test('expiry before claim, and after claim before invoke, never runs inference',async()=>{
 const f=fixture({advanceClock:20*60*1000});
 assert.equal((await runSixCallStep(f)).status,'BLOCKED');assert.equal(f.calls,0);
 const g=fixture();let times=0;
 const r=await runSixCallStep({...g,clock:()=>{times++;return times<3?now:now+20*60*1000}});
 assert.equal(r.status,'UNKNOWN_STOP');assert.equal(g.calls,0);assert.equal(g.store.claims,1);
});
test('post-claim creation-time or historical UNKNOWN drift consumes claim without invoking AI',async()=>{
 for(const [field,value] of [
  ['createdAtMs',now+1000],
  ['historicalUnknownPreserved',false]
 ]){
  const store=memoryStore();
  const originalClaim=store.claimOnce;
  store.claimOnce=async args=>{
   const claim=await originalClaim(args);
   assert.equal(claim.claimed,true);
   store.current[field]=value;
   return claim;
  };
  const f=fixture({store});
  const result=await runSixCallStep(f);
  assert.equal(result.status,'UNKNOWN_STOP',field);
  assert.equal(result.attempts,1,field);
  assert.equal(result.completed,0,field);
  assert.equal(store.claims,1,field);
  assert.equal(f.calls,0,field);
  assert.equal((await runSixCallStep(f)).status,'BLOCKED',field);
 }
});

test('duplicated simultaneous scheduler ticks get one durable claim',async()=>{
 const f=fixture();
 const results=await Promise.all([runSixCallStep(f),runSixCallStep(f)]);
 assert.equal(f.store.claims,1);assert.equal(f.calls,1);
 assert.equal(results.filter(r=>r.status==='STEP_COMPLETE').length,1);
 assert.equal(results.filter(r=>r.status==='BLOCKED').length,1);
});
test('evidence is data, never an independent deployment or inference authorization',()=>{
 const s={...candidate(),phase:'ACTIVE'};
 assert.equal(validLiveStepEvidence({status:'VERIFIED_FROM_TRUSTED_ADAPTER'},s,now),false);
 assert.equal(SMOKE_ATTEMPT_LIMIT,6);
});
