import test from 'node:test';
import assert from 'node:assert/strict';
import {V2_ROLES,OFFLINE_REPAIR_CAP,REAL_AI_SMOKE_CAP,REPO,validateHandoff,canRoleUse,classifyCIText,eventKey,runOfflineRepairCycle} from './core.mjs';
const D='a'.repeat(64),S='b'.repeat(40);
const event={repository:REPO,type:'CI_FAILED',source_id:'workflow_123',revision:'attempt_1',head_sha:S};
const handoff={task_id:'task_12345',run_id:'run_123456',from_role:'researcher',to_role:'designer',
 objective:'Investigate failing CI',artifacts:[{path:'offline_v2/report.md',digest:D}],
 evidence:[{kind:'GITHUB_CI',ref:'run_123456',digest:D}],
 constraints:['NO_LIVE','NO_UNKNOWN_RETRY'],current_status:'READY',next_action:'design offline patch',approval_required:false};
function journal(){
 const states=new Map();let claims=0;
 return {get claims(){return claims;},
 async claimOnce({key,maxAttempts}){
  const s=states.get(key)||{attempt:0,status:'NEW'};
  if(s.status!=='NEW'&&s.status!=='OFFLINE_FAILED')return {claimed:false};
  if(s.attempt>=maxAttempts)return {claimed:false};
  // Synchronous reservation before promises resolve: a *mock* unique claim.
  const attempt=s.attempt+1,lease='lease_'+attempt+'_'+key.length;
  states.set(key,{attempt,status:'CLAIMED',lease});claims++;
  return {claimed:true,key,attempt,lease};
 },
 async finish({key,lease,attempt,outcome}){
  const s=states.get(key);
  if(!s||s.lease!==lease||s.attempt!==attempt||s.status!=='CLAIMED')return {stored:false};
  s.status=outcome;return {stored:true,key,attempt,outcome};
 },
 getState(key){return states.get(key);}
 };
}
const caps=(store,override={})=>({event,store,
 diagnose:async()=>({sanitizedLog:'AssertionError: expected true',verifiedSource:true}),
 propose:async()=>({offlineOnly:true,expectedHeadSha:S,files:['offline_v2/core.mjs']}),
 test:async()=>({status:'PASS',digest:D}),
 audit:async()=>({status:'PASS',testDigest:D}),
 clock:()=>10000,...override});
test('logical roles and independent offline/live call limits',()=>{
 assert.deepEqual(V2_ROLES,['researcher','designer','implementer','tester','auditor','manager']);
 assert.equal(OFFLINE_REPAIR_CAP,2);assert.equal(REAL_AI_SMOKE_CAP,6);
});
test('bounded graph handoff is immutable, always non-authorizing',()=>{
 const r=validateHandoff(handoff);
 assert.equal(r.to_role,'designer');
 assert.equal(r.authorizesApproval,false);assert.equal(r.authorizesInference,false);
 assert.equal(Object.isFrozen(r.artifacts[0]),true);assert.equal(Object.isFrozen(r),true);
});
test('invalid handoff shapes, unauthorized graph edges and traversal fail closed',()=>{
 for(const p of [{to_role:'manager'},{extra:'self_approve'},
  {artifacts:[{path:'../secrets',digest:D}]},{from_role:'admin'},{approval_required:'false'}]){
  assert.equal(validateHandoff({...handoff,...p}).status,'BLOCKED');
 }
});
test('each logical role has only offline permissions; no self privilege extension',()=>{
 assert.equal(canRoleUse('implementer','write:isolated-branch').allowed,true);
 for(const role of [...V2_ROLES,'system'])for(const op of
   ['deploy:worker','write:d1','write:secrets','invoke:ai','approve:own-run']){
  assert.equal(canRoleUse(role,op).allowed,false);
 }
});
test('CI classes never log user text and scope failures cannot auto-correct security policy',()=>{
 for(const log of ['UNREVIEWED_SQL_OR_CODE_PATH','HTTP 403','quota exceeded','other error']){
  const r=classifyCIText(log);
  assert.equal(r.canAutofixOffline,false);assert.equal(JSON.stringify(r).includes(log),false);
 }
 assert.equal(classifyCIText('AssertionError: failure').canAutofixOffline,true);
 assert.equal(classifyCIText('AssertionError: failure HTTP 403').classification,'UNKNOWN');
});
test('event ID is stable, exact repo scoped and HEAD pinned',()=>{
 assert.equal(eventKey(event),eventKey({...event}));
 assert.equal(eventKey({...event,repository:'other/repo'}),null);
 assert.equal(eventKey({...event,head_sha:'fake'}),null);
});
test('parallel duplicate event has at most one mock durable claim',async()=>{
 const store=journal();
 const results=await Promise.all([runOfflineRepairCycle(caps(store)),runOfflineRepairCycle(caps(store))]);
 assert.equal(store.claims,1);
 assert.deepEqual(results.map(r=>r.status).sort(),['BLOCKED','REVIEW_READY']);
 assert.equal(results.find(r=>r.realAiAttempts!==undefined).realAiAttempts,0);
});
test('offline test failures retry at most two times (unrelated to 6 real AI calls)',async()=>{
 const store=journal(),options=caps(store,{test:async()=>({status:'FAIL',digest:D}),audit:async()=>({status:'FAIL'})});
 assert.equal((await runOfflineRepairCycle(options)).status,'OFFLINE_FAILED');
 assert.equal((await runOfflineRepairCycle(options)).offlineAttempt,2);
 assert.equal((await runOfflineRepairCycle(options)).status,'BLOCKED');
 assert.equal(store.claims,2);
});
test('uncertain test outcome terminates as UNKNOWN and never automatically retries',async()=>{
 const store=journal(),options=caps(store,{test:async()=>{throw Error('uncertain status')}});
 assert.equal((await runOfflineRepairCycle(options)).status,'UNKNOWN_STOP');
 assert.equal((await runOfflineRepairCycle(options)).status,'BLOCKED');assert.equal(store.claims,1);
});
test('unknown lease reservation cannot be retried',async()=>{
 const store={claimOnce:async()=>{throw Error('timeout')},finish:async()=>{throw Error('not reached')}};
 assert.equal((await runOfflineRepairCycle(caps(store))).reason,'CLAIM_OUTCOME_UNKNOWN_DO_NOT_RETRY');
});
test('approval/watchdog/new issue events do not authorize fixing',async()=>{
 for(const type of ['APPROVAL_CHANGED','WATCHDOG_ANOMALY','ISSUE_OPENED']){
  const store=journal(),r=await runOfflineRepairCycle(caps(store,{event:{...event,type}}));
  assert.equal(r.status,'BLOCKED');assert.equal(store.claims,0);
 }
});
test('missing independent source evidence cannot start a safe repair',async()=>{
 const store=journal(),r=await runOfflineRepairCycle(caps(store,{diagnose:async()=>({
  sanitizedLog:'AssertionError: x',verifiedSource:false})}));
 assert.equal(r.status,'UNKNOWN_STOP');assert.equal(r.authorizesLive,false);
});
test('production path, relative traversal or incorrect HEAD are rejected',async()=>{
 for(const [files,expectedHeadSha] of [
  [['worker-relay.mjs'],S],[['offline_v2/../bad.mjs'],S],[['offline_v2/core.mjs'],'c'.repeat(40)]]){
  const store=journal(),r=await runOfflineRepairCycle(caps(store,{propose:async()=>({
   offlineOnly:true,expectedHeadSha,files})}));
  assert.equal(r.status,'UNKNOWN_STOP');assert.equal(r.realAiAttempts,0);
 }
});
test('independent audit digest mismatch cannot mark a repair ready',async()=>{
 const store=journal(),r=await runOfflineRepairCycle(caps(store,{audit:async()=>({
  status:'PASS',testDigest:'0'.repeat(64)})}));
 assert.equal(r.status,'UNKNOWN_STOP');
});
