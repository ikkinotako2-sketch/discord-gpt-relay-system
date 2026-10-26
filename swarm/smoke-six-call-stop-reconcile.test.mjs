import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1SixCallStore} from './smoke-six-call-d1-store.mjs';
import {runSixCallStep} from './smoke-six-call-controller.mjs';
import {reconcileSixCallSmoke} from './smoke-six-call-reconcile.mjs';
import {DISCORD_SMOKE_TARGET as T,FLAGS} from './smoke-restore-guard.mjs';
import {HISTORICAL_UNKNOWN_FINGERPRINT as UNKNOWN} from './smoke-reviewed-unknown-safe-off.mjs';

const now=Date.UTC(2026,9,26,10,0,0),expiry=now+19*60*1000;
const owner='123456789012345678',other='223456789012345678';
const runId='smoke_safe_stop_20261026',receipt='receipt_20261026';
const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smoke='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const files=['schema.sql','smoke-six-call-d1-schema.review.sql',
 'smoke-six-call-owner-prepare-index.review.sql'];
function db(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON;');
 for(const f of files)sql.exec(readFileSync(new URL('./'+f,import.meta.url),'utf8'));
 sql.prepare(`INSERT INTO swarm_smoke_control_runs
 (run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,owner,receipt,T.accountId,
 T.worker,T.databaseId,baseline,smoke,'ACTIVE',now,now,expiry);
 // Preserve an original unrelated UNKNOWN forever.
 sql.prepare(`INSERT INTO swarm_jobs
 (run_id,owner_id,task,cycles,status,calls_used,last_error,
  created_at,updated_at,expires_at)
 VALUES(?,?,?,1,'unknown',1,?,?,?,?)`).run('historical_unknown_20261024',
 owner,'old',UNKNOWN.last_error,UNKNOWN.created_at,UNKNOWN.updated_at,expiry);
 const adapter={prepare(query){
  const stmt=sql.prepare(query);
  return {bind(...params){return{
   first:async()=>stmt.get(...params)??null,
   run:async()=>stmt.run(...params)
  };}};
 }};
 return {sql,store:createD1SixCallStore({db:adapter,runId})};
}
const dbReservation=s=>s.prepare('SELECT COALESCE(SUM(reserved),0) AS n FROM swarm_budget_days').get().n;
const req=f=>({runId,ownerId:owner,nowMs:now+10});
async function providerArgs(f){
 let calls=0;
 const args={store:f.store,clock:()=>now+2,
  liveEvidence:{collect:async()=>{const s=await f.store.read();return {
   status:'VERIFIED_FROM_TRUSTED_ADAPTER',checkedAtMs:now,target:T,runId,
   taskReceiptId:receipt,activeVersion:smoke,baselineVersion:baseline,
   expiresAtMs:expiry,ownerOauthCsrfVerified:true,newExplicitOwnerConsentVerified:true,
   watchdogIndependentlyPrearmed:true,watchdogLiveRestoreTested:true,
   releaseLockFencingVerified:true,remoteFourFlagsEnabledAndBounded:true,
   d1HistoryUnknownExactlyPreserved:true,legacyActiveJobs:0,otherSixRoleJobs:0,
   pendingStopJobs:0,accountPlanFreeVerified:true,modelAvailableVerified:true,
   accountWideSixCallsFreeMarginVerified:true,unrelatedAiIdleVerified:true,
   githubActiveReleaseRuns:0,emergencyStopReachable:true};}},
  provider:{invoke:async p=>{calls++;return{
   status:'FINAL_VERIFIED',stageIndex:p.stageIndex,receiptId:'mock_final_receipt_2026'
  };}}
 };
 return {args,calls:()=>calls};
}
function control(overrides={}){return{
 schema:'discord-six-call.v1',phase:'RESTORE_REQUIRED',
 runId,taskReceiptId:receipt,target:T,baselineVersion:baseline,
 smokeVersion:smoke,createdAtMs:now,expiresAtMs:expiry,
 attempts:6,completed:6,revision:12,inFlightIndex:null,
 stopRequested:false,historicalUnknownPreserved:true,
 authorizesInference:false,authorizesDeployment:false,...overrides
};}
function receipts(n=6,uncertain=false){return Array.from({length:n},(_,i)=>({
 run_id:runId,stage_index:i,state:uncertain&&i===n-1?'UNKNOWN':'FINAL_VERIFIED'
}));}
function watchdog(overrides={}){return{
 mode:'OFFLINE_SIMULATED_WATCHDOG_RECEIPT',target:T,
 baselineVersion:baseline,smokeVersion:smoke,expiresAtMs:expiry,
 armedAtMs:now+100,alarmPersisted:true,onceLatchPersisted:true,
 independentWorkerIdentityVerified:true,releaseSerializationHeld:true,
 ownerRecoveryApprovalScoped:true,...overrides
};}
function proof(overrides={}){return{
 mode:'OFFLINE_SIMULATED_POSTRESTORE_RECEIPT',target:T,
 checkedAtMs:expiry+1000,baselineVersion:baseline,deployedVersion:baseline,
 deployedPercentage:100,releaseLockHeld:true,
 signedDiscordRequestRejected401:true,ownerStopRouteVerified:true,
 watchdogParked:true,watchdogArmed:false,activeLegacyJobs:0,
 activeSixRoleJobs:0,pendingStopJobs:0,historicalUnknownCount:1,
 originalUnknown:{...UNKNOWN},
 remoteBindings:[{name:'LOOP_DB',type:'d1',database_id:T.databaseId}],
 controllerRunId:runId,controllerInFlightIndex:null,...overrides
};}
const audit=(s=control(),claims=receipts(6),wd=watchdog(),post=proof(),at=expiry+2000)=>
 reconcileSixCallSmoke({controller:s,claims,watchdog:wd,postRestore:post,nowMs:at});

test('idle owner STOP atomically prevents all later six-call claims',async()=>{
 const f=db();try{
  const r=await f.store.requestStopOnce(req(f));
  assert.equal(r.status,'STOP_RECORDED');
  assert.equal(r.phase,'RESTORE_REQUIRED');assert.equal(r.pendingInFlight,false);
  const next=await f.store.read();
  assert.equal(next.stopRequested,true);assert.equal(next.inFlightIndex,null);
  const x=await providerArgs(f);
  assert.equal((await runSixCallStep(x.args)).status,'BLOCKED');
  assert.equal(x.calls(),0);assert.equal(dbReservation(f.sql),0);
 }finally{f.sql.close();}
});
test('owner STOP while claimed keeps lease CAS but blocks next inference',async()=>{
 const f=db();try{
  const s=await f.store.read();
  const claim=await f.store.claimOnce({runId,expectedRevision:s.revision,
   index:0,expectedExpiryMs:expiry,nowMs:now+1,localDailyCap:6});
  assert.equal(claim.claimed,true);const rev=claim.revision;
  const stop=await f.store.requestStopOnce(req(f));
  assert.equal(stop.phase,'ACTIVE');assert.equal(stop.pendingInFlight,true);
  const recorded=await f.store.read();
  assert.equal(recorded.revision,rev);
  assert.equal(recorded.stopRequested,true);
  const x=await providerArgs(f);
  assert.equal((await runSixCallStep(x.args)).status,'BLOCKED');
  assert.equal(x.calls(),0);
  const settled=await f.store.finishOnce({runId,index:0,expectedClaimRevision:rev,
   outcome:'FINAL_VERIFIED',nowMs:now+30});
  assert.equal(settled.phase,'RESTORE_REQUIRED');
  assert.equal(settled.completed,1);
  assert.equal(dbReservation(f.sql),1);
 }finally{f.sql.close();}
});
test('ambiguous in-flight result after STOP consumes reservation and stays terminal',async()=>{
 const f=db();try{
  const claimed=await f.store.claimOnce({runId,expectedRevision:0,
   index:0,expectedExpiryMs:expiry,nowMs:now+1,localDailyCap:6});
  await f.store.requestStopOnce(req(f));
  const settled=await f.store.finishOnce({runId,index:0,
   expectedClaimRevision:claimed.revision,outcome:'UNKNOWN',nowMs:now+20});
  assert.equal(settled.phase,'RESTORE_REQUIRED');
  assert.equal(settled.completed,0);
  assert.equal((await f.store.read()).stopRequested,true);
  assert.equal(dbReservation(f.sql),1);
 }finally{f.sql.close();}
});
test('cross-owner STOP must not reveal or change the owner job',async()=>{
 const f=db();try{
  const r=await f.store.requestStopOnce({runId,ownerId:other,nowMs:now+10});
  assert.equal(r.status,'BLOCKED');assert.equal((await f.store.read()).phase,'ACTIVE');
  assert.equal((await f.store.read()).stopRequested,false);
  await f.store.requestStopOnce(req(f));
  const retry=await f.store.requestStopOnce({runId,ownerId:other,nowMs:now+20});
  assert.equal(retry.status,'BLOCKED');
 }finally{f.sql.close();}
});
test('double STOP never reopens or double-increments counters',async()=>{
 const f=db();try{
  const [x,y]=await Promise.all([f.store.requestStopOnce(req(f)),
   f.store.requestStopOnce(req(f))]);
  assert.equal(x.status,'STOP_RECORDED');
  assert.equal(y.status,'BLOCKED');
  assert.equal((await f.store.read()).revision,1);
  assert.equal(dbReservation(f.sql),0);
 }finally{f.sql.close();}
});
test('pending STOP yields BLOCKED, never creates a provider claim',async()=>{
 const f=db();try{
  f.sql.prepare("UPDATE swarm_smoke_control_runs SET phase='PENDING'").run();
  const r=await f.store.requestStopOnce(req(f));
  assert.equal(r.status,'STOP_RECORDED');
  assert.equal(r.phase,'BLOCKED');assert.equal(dbReservation(f.sql),0);
 }finally{f.sql.close();}
});
test('historical immutable UNKNOWN unchanged through STOP, claim and settle',async()=>{
 const f=db();try{
  const old=f.sql.prepare("SELECT * FROM swarm_jobs WHERE run_id='historical_unknown_20261024'").get();
  const claim=await f.store.claimOnce({runId,expectedRevision:0,index:0,
   expectedExpiryMs:expiry,nowMs:now+1,localDailyCap:6});
  await f.store.requestStopOnce(req(f));
  await f.store.finishOnce({runId,index:0,expectedClaimRevision:claim.revision,
   outcome:'UNKNOWN',nowMs:now+40});
  const current=f.sql.prepare("SELECT * FROM swarm_jobs WHERE run_id='historical_unknown_20261024'").get();
  assert.deepEqual(current,old);
 }finally{f.sql.close();}
});
test('six finals and verified OFF only counts full success offline, never release',()=>{
 const r=audit();assert.equal(r.status,'SIMULATED_SAFE_OFF_SIX_FINALS');
 assert.equal(r.reservedAttempts,6);assert.equal(r.verifiedFinals,6);
 assert.equal(r.authorizesInference,false);assert.equal(r.authorizesRestore,false);
 assert.equal(r.productionVerification,false);
});
test('one preserved old UNKNOWN plus new UNKNOWN reports incomplete safe OFF',()=>{
 const r=audit(control({attempts:1,completed:0,revision:2}),
  receipts(1,true));
 assert.equal(r.status,'SIMULATED_SAFE_OFF_INCOMPLETE');
 assert.equal(r.originalUnknownPreserved,true);assert.equal(r.verifiedFinals,0);
});
test('in-flight model claim with STOP returns manual recovery, not 6/6',()=>{
 const s=control({phase:'ACTIVE',attempts:1,completed:0,
  revision:1,stopRequested:true,inFlightIndex:0});
 const r=audit(s,[{run_id:runId,stage_index:0,state:'CLAIMED'}]);
 assert.equal(r.status,'HOLD_FOR_STOP_AND_RESTORE');
 assert.equal(r.manualRecoveryRequired,true);
});
test('no prearmed independent alarm never passes safety check',()=>{
 for(const w of [
  watchdog({alarmPersisted:false}),
  watchdog({onceLatchPersisted:false}),
  watchdog({armedAtMs:expiry+1}),
  watchdog({releaseSerializationHeld:false}),
  watchdog({ownerRecoveryApprovalScoped:false}),
  watchdog({independentWorkerIdentityVerified:false}),
  watchdog({baselineVersion:smoke})
 ])assert.equal(audit(control(),receipts(6),w).status,'BLOCKED_MANUAL_REVIEW');
});
test('postrestore cannot declare OFF with false, missing or duplicate SWARM flags',()=>{
 const good=proof();
 for(const remoteBindings of [
  null,[{name:'LOOP_DB',type:'d1',database_id:'wrong'}],
  [...good.remoteBindings,{name:FLAGS[0],type:'plain_text',text:'true'}],
  [...good.remoteBindings,{name:FLAGS[0],type:'plain_text',text:'false'},
    {name:FLAGS[0],type:'plain_text',text:'false'}],
  [...good.remoteBindings,{name:FLAGS[0],type:'secret_text'}],
 ])assert.equal(audit(control(),receipts(6),watchdog(),proof({remoteBindings})).status,
  'BLOCKED_MANUAL_REVIEW');
});
test('postrestore fails closed on historical UNKNOWN mutation and active D1 jobs',()=>{
 for(const p of [
  {originalUnknown:{...UNKNOWN,last_error:'CLEAN'}},
  {historicalUnknownCount:0},{activeLegacyJobs:1},
  {activeSixRoleJobs:1},{pendingStopJobs:1},
  {controllerInFlightIndex:0},
  {watchdogParked:false},{watchdogParked:undefined},
  {watchdogArmed:true},{watchdogArmed:undefined},
  {signedDiscordRequestRejected401:false},
  {ownerStopRouteVerified:false},
  {deployedPercentage:50},{deployedVersion:smoke},
  {checkedAtMs:expiry-6*60*1000},
  {releaseLockHeld:false}
 ])assert.equal(audit(control(),receipts(6),watchdog(),proof(p)).status,
  'BLOCKED_MANUAL_REVIEW');
});
test('reconciliation rejects extra/missing/duplicated or unverified claimed receipts',()=>{
 for(const bad of [
  receipts(5),[...receipts(6),{run_id:runId,stage_index:6,state:'FINAL_VERIFIED'}],
  receipts(6).map((r,i)=>({...r,stage_index:i===1?0:i})),
  receipts(6).map((r,i)=>({...r,run_id:i===1?'wrong':r.run_id})),
  receipts(6).map((r,i)=>({...r,state:i===1?'CLAIMED':r.state}))
 ])assert.equal(audit(control(),bad).status,'BLOCKED_MANUAL_REVIEW');
});
test('no baseline proof after restore-required status does not claim success',()=>{
 assert.equal(audit(control(),receipts(6),watchdog(),null).status,
  'BLOCKED_MANUAL_REVIEW');
});
test('expiry without restored proof calls for safety stop, not more inference',()=>{
 const s=control({phase:'ACTIVE',attempts:2,completed:2,revision:4});
 const r=audit(s,receipts(2),watchdog(),null,expiry+1);
 assert.equal(r.status,'HOLD_FOR_STOP_AND_RESTORE');
 assert.equal(r.authorizesInference,false);
});
test('invalid target, impossible counters and PENDING cannot be treated as safe restore',()=>{
 for(const s of [
  control({target:{...T,worker:'other'}}),
  control({attempts:7}),control({completed:7}),
  control({stopRequested:'true'}),control({expiresAtMs:now+21*60*1000}),
  control({inFlightIndex:5}),control({authorizesInference:true})
 ])assert.equal(audit(s).status,'BLOCKED_MANUAL_REVIEW');
 const pending=audit(control({phase:'PENDING',attempts:0,completed:0,revision:0}),[]);
 assert.equal(pending.status,'NOT_RUNNING');
});
