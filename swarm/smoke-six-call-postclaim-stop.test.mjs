import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1SixCallStore} from './smoke-six-call-d1-store.mjs';
import {runSixCallStep,makeSixCallCandidate}
 from './smoke-six-call-controller.mjs';
import {DISCORD_SMOKE_TARGET as T} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,27,10,0,0);
const expiry=now+19*60_000;
const owner='123456789012345678';
const runId='smoke_postclaim_stop_20261027';
const receipt='owner_review_receipt_20261027';
const v0='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const v1='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const schemaFiles=['schema.sql','smoke-six-call-d1-schema.review.sql',
 'smoke-six-call-owner-prepare-index.review.sql'];
const row=(db,sql,params=[])=>db.prepare(sql).get(...params);
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');
 for(const file of schemaFiles)
  sql.exec(readFileSync(new URL('./'+file,import.meta.url),'utf8'));
 sql.prepare(`INSERT INTO swarm_smoke_control_runs(
 run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,owner,receipt,T.accountId,
  T.worker,T.databaseId,v0,v1,'ACTIVE',now,now,expiry);
 const db={prepare(query){
  const stmt=sql.prepare(query);
  return {bind(...args){return {
   first:async()=>stmt.get(...args)??null,
   run:async()=>stmt.run(...args)
  };}};
 }};
 const store=createD1SixCallStore({db,runId});
 return {sql,db,store};
}
const budget=f=>row(f.sql,`SELECT COALESCE(SUM(reserved),0) AS n FROM swarm_budget_days`).n;
const counts=f=>row(f.sql,`SELECT COUNT(*) AS n FROM swarm_smoke_control_claims`).n;
const evidence=s=>({
 status:'VERIFIED_FROM_TRUSTED_ADAPTER',checkedAtMs:now,target:T,runId,
 taskReceiptId:receipt,activeVersion:v1,baselineVersion:v0,
 expiresAtMs:expiry,ownerOauthCsrfVerified:true,newExplicitOwnerConsentVerified:true,
 watchdogIndependentlyPrearmed:true,watchdogLiveRestoreTested:true,
 releaseLockFencingVerified:true,remoteFourFlagsEnabledAndBounded:true,
 d1HistoryUnknownExactlyPreserved:true,legacyActiveJobs:0,otherSixRoleJobs:0,
 pendingStopJobs:0,accountPlanFreeVerified:true,modelAvailableVerified:true,
 accountWideSixCallsFreeMarginVerified:true,unrelatedAiIdleVerified:true,
 githubActiveReleaseRuns:0,emergencyStopReachable:true
});
function runner(f,{store=f.store,clock=()=>now+2,invoke}={}){
 let calls=0;
 const provider={invoke:async details=>{
  calls++;
  return invoke ? await invoke(details) : {
   status:'FINAL_VERIFIED',stageIndex:details.stageIndex,
   receiptId:'provider_verified_receipt_20261027'
  };
 }};
 return {calls:()=>calls,step:()=>runSixCallStep({store,
  liveEvidence:{collect:async()=>evidence(await f.store.read())},
  provider,clock
 })};
}
async function stop(f,t=now+5){return f.store.requestStopOnce({runId,ownerId:owner,nowMs:t});}
test('normal six genuine SQLite reservations finalize and never invoke seventh',async()=>{
 const f=setup();try{
  const x=runner(f);
  for(let i=0;i<6;i++){
   const status=await x.step();
   assert.equal(status.attempts,i+1);
   assert.equal(status.completed,i+1);
   assert.equal(budget(f),i+1);
  }
  assert.equal((await x.step()).status,'BLOCKED');
  assert.equal(x.calls(),6);
  assert.equal(counts(f),6);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
 }finally{f.sql.close();}
});
test('owner STOP AFTER successful atomic claim but BEFORE model means zero model calls',async()=>{
 const f=setup();try{
  const wrapped={
   read:f.store.read,finishOnce:f.store.finishOnce,
   claimOnce:async data=>{
    const claimed=await f.store.claimOnce(data);
    assert.equal(claimed.claimed,true);
    const stopped=await stop(f);
    assert.equal(stopped.pendingInFlight,true);
    return claimed;
   }
  };
  const x=runner(f,{store:wrapped});
  const result=await x.step();
  assert.equal(result.status,'UNKNOWN_STOP');
  assert.equal(result.restoreRequired,true);
  assert.equal(result.attempts,1);assert.equal(result.completed,0);
  assert.equal(x.calls(),0);
  assert.equal(budget(f),1);assert.equal(counts(f),1);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
  assert.equal((await f.store.read()).stopRequested,true);
  assert.equal((await x.step()).status,'BLOCKED');
  assert.equal(x.calls(),0);
 }finally{f.sql.close();}
});
test('owner STOP WHILE provider in flight reports restore needed, never STEP_COMPLETE',async()=>{
 const f=setup();try{
  const x=runner(f,{invoke:async p=>{
   assert.equal((await stop(f)).status,'STOP_RECORDED');
   return {status:'FINAL_VERIFIED',stageIndex:p.stageIndex,
    receiptId:'provider_verified_receipt_20261027'};
  }});
  const result=await x.step();
  assert.equal(result.status,'STOP_OR_EXPIRY_RESTORE_REQUIRED');
  assert.equal(result.restoreRequired,true);
  assert.equal(result.completed,1);assert.equal(result.attempts,1);
  assert.equal(x.calls(),1);
  assert.equal((await x.step()).status,'BLOCKED');
  assert.equal(x.calls(),1);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
 }finally{f.sql.close();}
});
test('D1 read failure AFTER claim prevents provider and permanently consumes reserved call',async()=>{
 const f=setup();try{
  let readCount=0;
  const wrapped={
   ...f.store,
   read:async()=>{readCount++;if(readCount===2)throw Error('D1_DISCONNECTED');
    return f.store.read();}
  };
  const x=runner(f,{store:wrapped});
  assert.equal((await x.step()).status,'UNKNOWN_STOP');
  assert.equal(x.calls(),0);assert.equal(budget(f),1);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
 }finally{f.sql.close();}
});
test('postclaim read shows run version drift -> no inference and UNKNOWN settlement',async()=>{
 const f=setup();try{
  let count=0;
  const wrapped={...f.store,read:async()=>{
   const state=await f.store.read();
   count++;
   return count===2?{...state,smokeVersion:'38c379e8-e759-4b2f-8300-e7a4c8b39b83'}:state;
  }};
  const x=runner(f,{store:wrapped});
  assert.equal((await x.step()).status,'UNKNOWN_STOP');
  assert.equal(x.calls(),0);assert.equal(budget(f),1);
 }finally{f.sql.close();}
});
test('postclaim STOP on synthetic state also refuses any new provider invoke',async()=>{
 const f=setup();try{
  let count=0;
  const wrapped={...f.store,read:async()=>{
   const state=await f.store.read();
   count++;
   return count===2?{...state,stopRequested:true}:state;
  }};
  const x=runner(f,{store:wrapped});
  assert.equal((await x.step()).status,'UNKNOWN_STOP');
  assert.equal(x.calls(),0);assert.equal(budget(f),1);
 }finally{f.sql.close();}
});
test('reservation delayed beyond absolute deadline cannot invoke AI',async()=>{
 const f=setup();try{
  let count=0;
  const x=runner(f,{clock:()=>{count++;return count<3?now+2:expiry;}});
  const r=await x.step();
  assert.equal(r.status,'UNKNOWN_STOP');
  assert.equal(x.calls(),0);assert.equal(budget(f),1);
 }finally{f.sql.close();}
});
test('two concurrent scheduler triggers allow one provider call, no double reserve',async()=>{
 const f=setup();try{
  const x=runner(f);
  const results=await Promise.all([x.step(),x.step()]);
  assert.equal(results.filter(y=>y.status==='STEP_COMPLETE').length,1);
  assert.equal(results.filter(y=>y.status==='BLOCKED').length,1);
  assert.equal(x.calls(),1);assert.equal(counts(f),1);assert.equal(budget(f),1);
 }finally{f.sql.close();}
});
test('provider error is UNKNOWN and never re-used or silently reset',async()=>{
 const f=setup();try{
  const x=runner(f,{invoke:()=>{throw Error('PROVIDER_OUTCOME_UNKNOWN')}});
  const a=await x.step();assert.equal(a.status,'UNKNOWN_STOP');
  assert.equal((await x.step()).status,'BLOCKED');
  assert.equal(x.calls(),1);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
  assert.equal(budget(f),1);
 }finally{f.sql.close();}
});
test('missing safe-off evidence before claim cannot create a reservation',async()=>{
 const f=setup();try{
  let called=0;
  const r=await runSixCallStep({
   store:f.store,clock:()=>now,
   liveEvidence:{collect:async()=>({...evidence(),watchdogIndependentlyPrearmed:false})},
   provider:{invoke:async()=>{called++;throw Error('UNEXPECTED_MODEL_CALL')}}
  });
  assert.equal(r.status,'BLOCKED');
  assert.equal(counts(f),0);assert.equal(budget(f),0);assert.equal(called,0);
 }finally{f.sql.close();}
});
test('no STOP authorization/activation implicit in draft candidate',()=>{
 const c=makeSixCallCandidate({
  runId,taskReceiptId:receipt,baselineVersion:v0,smokeVersion:v1,
  nowMs:now,expiresAtMs:expiry
 });
 assert.equal(c.phase,'PENDING_EXTERNAL_ACTIVATION');
 assert.equal(c.stopRequested,false);
 assert.equal(c.authorizesInference,false);
 assert.equal(c.authorizesDeployment,false);
});
test('local SQLite migration cannot update legacy UNKNOWN on its own',async()=>{
 const f=setup();try{
  f.sql.prepare(`INSERT INTO swarm_jobs(
   run_id,owner_id,task,cycles,status,calls_used,last_error,
   created_at,updated_at,expires_at)
   VALUES(?,?,?,1,'unknown',1,?,?,?,?)`).run(
    'historic_unknown_20261024',owner,'immutable',
    'MODEL_OUTCOME_UNKNOWN',now-1000,now-900,expiry);
  const original=row(f.sql,`SELECT * FROM swarm_jobs WHERE run_id='historic_unknown_20261024'`);
  const x=runner(f);await x.step();await stop(f);
  const still=row(f.sql,`SELECT * FROM swarm_jobs WHERE run_id='historic_unknown_20261024'`);
  assert.deepEqual(still,original);
 }finally{f.sql.close();}
});
