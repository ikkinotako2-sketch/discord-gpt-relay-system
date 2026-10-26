import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createD1SixCallStore} from './smoke-six-call-d1-store.mjs';
import {runSixCallStep} from './smoke-six-call-controller.mjs';
import {DISCORD_SMOKE_TARGET as target} from './smoke-restore-guard.mjs';

const base=Date.UTC(2026,9,26,12,0,0);
const owner='123456789012345678';
const runId='smoke_d1_test_20261026';
const receipt='owner_receipt_20261026';
const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smoke='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
const migration=readFileSync(new URL('./smoke-six-call-d1-schema.review.sql',import.meta.url),'utf8');
function fakeD1(db){
 return {prepare(sql){
  const statement=db.prepare(sql);
  return {bind(...p){return {
    first:async()=>statement.get(...p)??null,
    run:async()=>statement.run(...p)
  };}};
 }};
}
function setup({phase='ACTIVE',cap=null,file=':memory:',oldUnknown=false}={}){
 const sqlite=new DatabaseSync(file);
 sqlite.exec('PRAGMA foreign_keys=ON;');
 sqlite.exec(schema);
 sqlite.exec(migration);
 if(oldUnknown){
  sqlite.prepare(`INSERT INTO swarm_jobs(run_id,owner_id,task,cycles,status,calls_used,created_at,updated_at,expires_at)
   VALUES(?,?,?,1,'unknown',1,?,?,?)`).run('historical_unknown_1',owner,'original',base-5000,base-4000,base+100000);
 }
 sqlite.prepare(`INSERT INTO swarm_smoke_control_runs
 (run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  runId,owner,receipt,target.accountId,target.worker,target.databaseId,
  baseline,smoke,phase,base,base,base+19*60*1000);
 if(cap!==null)sqlite.prepare(`INSERT INTO swarm_budget_days(owner_id,utc_day,cap,reserved,updated_at)
 VALUES(?,?,?,?,?)`).run(owner,'2026-10-26',cap,0,base);
 return {sqlite,db:fakeD1(sqlite),get store(){return createD1SixCallStore({db:this.db,runId})}};
}
const truth=s=>({
 status:'VERIFIED_FROM_TRUSTED_ADAPTER',checkedAtMs:base,target,
 runId:s.runId,taskReceiptId:s.taskReceiptId,activeVersion:s.smokeVersion,
 baselineVersion:s.baselineVersion,expiresAtMs:s.expiresAtMs,
 ownerOauthCsrfVerified:true,newExplicitOwnerConsentVerified:true,
 watchdogIndependentlyPrearmed:true,watchdogLiveRestoreTested:true,
 releaseLockFencingVerified:true,remoteFourFlagsEnabledAndBounded:true,
 d1HistoryUnknownExactlyPreserved:true,legacyActiveJobs:0,
 otherSixRoleJobs:0,pendingStopJobs:0,accountPlanFreeVerified:true,
 modelAvailableVerified:true,accountWideSixCallsFreeMarginVerified:true,
 unrelatedAiIdleVerified:true,githubActiveReleaseRuns:0,emergencyStopReachable:true
});
function invokeWith(f,{providerResult,indexOverride,clock=()=>base}={}){
 let invoked=0;
 return {step:()=>runSixCallStep({
   store:f.store,clock,liveEvidence:{collect:async()=>truth(await f.store.read())},
   provider:{invoke:async({stageIndex})=>{
    invoked++;return providerResult===undefined?
      {status:'FINAL_VERIFIED',stageIndex:indexOverride??stageIndex,receiptId:'receipt_ok_20261026'}:
      providerResult;
   }}
 }),calls:()=>invoked};
}
const localCount=db=>db.prepare("SELECT reserved FROM swarm_budget_days WHERE owner_id=? AND utc_day=?").get(owner,'2026-10-26')?.reserved??0;
const claims=db=>db.prepare("SELECT stage_index,state FROM swarm_smoke_control_claims ORDER BY stage_index").all();

test('schema never modifies original historical UNKNOWN row',async()=>{
 const f=setup({oldUnknown:true});
 try{
  const before=f.sqlite.prepare("SELECT * FROM swarm_jobs WHERE run_id=?").get('historical_unknown_1');
  assert.equal((await invokeWith(f).step()).status,'STEP_COMPLETE');
  const after=f.sqlite.prepare("SELECT * FROM swarm_jobs WHERE run_id=?").get('historical_unknown_1');
  assert.deepEqual(after,before);
  assert.equal(localCount(f.sqlite),1);
 }finally{f.sqlite.close();}
});
test('six real SQLite atomic claims reserve exactly six then stop',async()=>{
 const f=setup();
 try{
  const runner=invokeWith(f);let result;
  for(let i=0;i<6;i++){
   result=await runner.step();
   assert.equal(result.completed,i+1);
   assert.equal(localCount(f.sqlite),i+1);
  }
  assert.equal(result.status,'SIX_CALL_LIMIT_REACHED');
  assert.equal(claims(f.sqlite).length,6);
  assert.equal(runner.calls(),6);
  assert.equal((await runner.step()).status,'BLOCKED');
  assert.equal(runner.calls(),6);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
 }finally{f.sqlite.close();}
});
test('atomic claimed attempt survives adapter recreation without duplicate provider call',async()=>{
 const f=setup();try{
  const before=await f.store.read();
  const claimed=await f.store.claimOnce({
   runId,expectedRevision:0,index:0,expectedExpiryMs:before.expiresAtMs,
   nowMs:base,localDailyCap:6});
  assert.equal(claimed.claimed,true);
  assert.equal(localCount(f.sqlite),1);
  const newInstance=createD1SixCallStore({db:f.db,runId});
  const runner=invokeWith({store:newInstance});
  assert.equal((await runner.step()).status,'BLOCKED');
  assert.equal(runner.calls(),0);
  assert.equal(claims(f.sqlite).length,1);
 }finally{f.sqlite.close();}
});
test('no double claim from two concurrent controller ticks',async()=>{
 const f=setup();try{
  const runner=invokeWith(f);
  const results=await Promise.all([runner.step(),runner.step()]);
  assert.equal(results.filter(x=>x.status==='STEP_COMPLETE').length,1);
  assert.equal(results.filter(x=>x.status==='BLOCKED').length,1);
  assert.equal(runner.calls(),1);
  assert.equal(localCount(f.sqlite),1);
 }finally{f.sqlite.close();}
});
test('existing local daily cap lower than six stops at that cap',async()=>{
 const f=setup({cap:2});try{
  const runner=invokeWith(f);
  assert.equal((await runner.step()).status,'STEP_COMPLETE');
  assert.equal((await runner.step()).status,'STEP_COMPLETE');
  assert.equal((await runner.step()).status,'BLOCKED');
  assert.equal(runner.calls(),2);
  assert.equal(localCount(f.sqlite),2);
  assert.equal(claims(f.sqlite).length,2);
 }finally{f.sqlite.close();}
});
test('day-reservation cap from another producer is honored',async()=>{
 const f=setup({cap:6});try{
  f.sqlite.prepare("UPDATE swarm_budget_days SET reserved=5 WHERE owner_id=?").run(owner);
  const runner=invokeWith(f);
  assert.equal((await runner.step()).status,'STEP_COMPLETE');
  assert.equal((await runner.step()).status,'BLOCKED');
  assert.equal(localCount(f.sqlite),6);
  assert.equal(runner.calls(),1);
 }finally{f.sqlite.close();}
});
test('unknown provider result leaves permanent restore required and one reservation',async()=>{
 const f=setup();try{
  const runner=invokeWith(f,{providerResult:{status:'UNKNOWN'}});
  const first=await runner.step();
  assert.equal(first.status,'UNKNOWN_STOP');
  assert.equal((await runner.step()).status,'BLOCKED');
  assert.equal(localCount(f.sqlite),1);
  assert.equal(runner.calls(),1);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
  assert.equal(claims(f.sqlite)[0].state,'UNKNOWN');
 }finally{f.sqlite.close();}
});
test('unconfirmed settlement never retries and leaves claim in flight',async()=>{
 const f=setup();try{
  const adapter=f.store;
  const broken={read:adapter.read,claimOnce:adapter.claimOnce,
   finishOnce:async()=>{throw Error('lost confirmation')}};
  let calls=0;
  const args={store:broken,clock:()=>base,
   liveEvidence:{collect:async()=>truth(await adapter.read())},
   provider:{invoke:async({stageIndex})=>{
    calls++;return {status:'FINAL_VERIFIED',stageIndex,receiptId:'receipt_valid_1'};
   }}};
  assert.equal((await runSixCallStep(args)).reason,'SETTLEMENT_UNCERTAIN_DO_NOT_RETRY');
  assert.equal((await runSixCallStep(args)).status,'BLOCKED');
  assert.equal(calls,1);
  assert.equal((await adapter.read()).inFlightIndex,0);
  assert.equal(localCount(f.sqlite),1);
 }finally{f.sqlite.close();}
});
test('CAS replay and settlement replay are rejected without budget changes',async()=>{
 const f=setup();try{
  const claim={runId,index:0,expectedRevision:0,expectedExpiryMs:base+19*60000,
    nowMs:base,localDailyCap:6};
  const first=await f.store.claimOnce(claim);assert.equal(first.claimed,true);
  assert.equal((await f.store.claimOnce(claim)).claimed,false);
  const settled=await f.store.finishOnce({
    runId,index:0,expectedClaimRevision:first.revision,
    outcome:'FINAL_VERIFIED',nowMs:base+1});
  assert.equal(settled.completed,1);
  await assert.rejects(f.store.finishOnce({
    runId,index:0,expectedClaimRevision:first.revision,
    outcome:'FINAL_VERIFIED',nowMs:base+2
  }));
  assert.equal(localCount(f.sqlite),1);
 }finally{f.sqlite.close();}
});
test('late claim and forged UTC day do not reserve local budget',async()=>{
 const f=setup();try{
  const s=await f.store.read();
  assert.equal((await f.store.claimOnce({
   runId,index:0,expectedRevision:0,expectedExpiryMs:s.expiresAtMs,
   nowMs:s.expiresAtMs,localDailyCap:6})).claimed,false);
  assert.throws(()=>f.sqlite.prepare(`INSERT INTO swarm_smoke_control_claims
   (run_id,stage_index,owner_id,utc_day,claimed_at_ms) VALUES(?,?,?,?,?)`)
   .run(runId,0,owner,'2026-10-25',base));
  assert.equal(localCount(f.sqlite),0);
  assert.equal(claims(f.sqlite).length,0);
 }finally{f.sqlite.close();}
});
test('pending never activated by adapter and wrong D1 identity rejects read',async()=>{
 const f=setup({phase:'PENDING'});try{
  assert.equal((await invokeWith(f).step()).status,'BLOCKED');
  assert.equal(claims(f.sqlite).length,0);
  f.sqlite.prepare("UPDATE swarm_smoke_control_runs SET database_id=? WHERE run_id=?")
   .run('00000000-0000-0000-0000-000000000000',runId);
  await assert.rejects(f.store.read());
 }finally{f.sqlite.close();}
});
test('on-disk SQLite restart retains claimed step and no replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'discord-six-call-offline-'));
 try{
  const path=join(dir,'state.db');
  const a=setup({file:path});
  const s=await a.store.read();
  await a.store.claimOnce({runId,index:0,expectedRevision:0,
    expectedExpiryMs:s.expiresAtMs,nowMs:base,localDailyCap:6});
  a.sqlite.close();
  const sqlite=new DatabaseSync(path);
  try{
   const store=createD1SixCallStore({db:fakeD1(sqlite),runId});
   assert.equal((await store.read()).inFlightIndex,0);
   assert.equal((await invokeWith({store}).step()).status,'BLOCKED');
   assert.equal(localCount(sqlite),1);
  }finally{sqlite.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('migration avoids altering original swarm schema and is standalone',()=>{
 assert.ok(!migration.includes('DROP TABLE'));
 assert.ok(!migration.includes('ALTER TABLE'));
 assert.ok(!migration.includes('UPDATE swarm_jobs'));
 assert.ok(!migration.includes('DELETE FROM swarm_jobs'));
 assert.match(migration,/CREATE TRIGGER IF NOT EXISTS swarm_smoke_control_claim_atomic/);
 assert.match(migration,/CREATE TRIGGER IF NOT EXISTS swarm_smoke_control_settle_atomic/);
});
