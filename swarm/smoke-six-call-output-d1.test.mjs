import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createStagedD1SixCallOutputStore}
 from './smoke-six-call-output-d1.mjs';
import {createStagedSixCallAIProvider}
 from './smoke-six-call-provider-adapter.mjs';
import {createD1SixCallStore} from './smoke-six-call-d1-store.mjs';
import {runSixCallStep} from './smoke-six-call-controller.mjs';
import {DISCORD_SMOKE_TARGET as T,FLAGS} from './smoke-restore-guard.mjs';
import {GPT_OSS_MODEL} from '../loop-quality.mjs';
const now=Date.UTC(2026,9,27,13,0);
const expiry=now+19*60_000;
const ownerId='123456789012345678';
const runId='smoke_output_review_20261027';
const receipt='reviewed_output_receipt_20261027';
const baseVersion='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smokeVersion='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const digest=s=>createHash('sha256').update(s).digest('hex');
function setup(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 for(const p of ['schema.sql','smoke-six-call-d1-schema.review.sql',
  'smoke-six-call-owner-prepare-index.review.sql',
  'smoke-six-call-output-artifacts.review.sql'])
  sqlite.exec(readFileSync(new URL('./'+p,import.meta.url),'utf8'));
 sqlite.prepare(`INSERT INTO swarm_smoke_control_runs(
 run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,ownerId,receipt,
 T.accountId,T.worker,T.databaseId,baseVersion,smokeVersion,
 'ACTIVE',now,now,expiry);
 const db={prepare(sql){const statement=sqlite.prepare(sql);
  return {bind(...args){return {
   first:async()=>statement.get(...args)??null,
   run:async()=>statement.run(...args)
  };}};}};
 const controller=createD1SixCallStore({db,runId});
 const outputs=createStagedD1SixCallOutputStore({db,runId,ownerId,clock:()=>now+3});
 const env={SWARM_DAILY_CALL_CAP:'6',SMOKE_AI_PROVIDER_ENABLED:'true',
  SMOKE_PINNED_MODEL:GPT_OSS_MODEL,SWARM_SMOKE_EXPIRES_AT:String(expiry),
  DISCORD_ALLOWED_USER_ID:ownerId,...Object.fromEntries(FLAGS.map(n=>[n,'true']))};
 let modelCalls=0;
 env.AI={run:async(_model,payload)=>{
  modelCalls++;
  assert.equal(payload.max_tokens,360);
  return {response:'確認済み第'+modelCalls+'段階の出力'};
 }};
 const provider=createStagedSixCallAIProvider({
  env,clock:()=>now+5,
  loadVerifiedTask:async details=>({
   ...details,source:'SERVER_D1_VERIFIED_OWNER_TASK',
   ownerId,expiryMs:expiry,checkedAtMs:now,
   previousStageFinalVerified:true,
   legacyHistoricalUnknownImmutable:true,
   originalTask:'Discord運営を安全に進める',
   previousConfirmedOutput:await outputs.getLastConfirmedOutput({stageIndex:details.stageIndex})
  }),
  persistVerifiedOutput:outputs.persistVerifiedOutput
 });
 const liveEvidence={collect:async()=>({
  status:'VERIFIED_FROM_TRUSTED_ADAPTER',
  checkedAtMs:now,target:T,runId,taskReceiptId:receipt,
  activeVersion:smokeVersion,baselineVersion:baseVersion,expiresAtMs:expiry,
  ownerOauthCsrfVerified:true,newExplicitOwnerConsentVerified:true,
  watchdogIndependentlyPrearmed:true,watchdogLiveRestoreTested:true,
  releaseLockFencingVerified:true,remoteFourFlagsEnabledAndBounded:true,
  d1HistoryUnknownExactlyPreserved:true,legacyActiveJobs:0,
  otherSixRoleJobs:0,pendingStopJobs:0,accountPlanFreeVerified:true,
  modelAvailableVerified:true,accountWideSixCallsFreeMarginVerified:true,
  unrelatedAiIdleVerified:true,githubActiveReleaseRuns:0,
  emergencyStopReachable:true
 })};
 return {sqlite,db,controller,outputs,provider,liveEvidence,env,
  modelCalls:()=>modelCalls};
}
const row=(f,sql,...a)=>f.sqlite.prepare(sql).get(...a);
test('six fake model calls persist six verified real SQLite rows and seventh is blocked',async()=>{
 const f=setup();
 try{
  for(let i=0;i<6;i++){
   const x=await runSixCallStep({store:f.controller,
    liveEvidence:f.liveEvidence,provider:f.provider,clock:()=>now+10});
   assert.equal(x.attempts,i+1);
   assert.equal(x.completed,i+1);
   assert.equal(x.status,i===5?'SIX_CALL_LIMIT_REACHED':'STEP_COMPLETE');
   assert.equal(row(f,'SELECT COUNT(*) AS n FROM swarm_smoke_control_outputs').n,i+1);
  }
  assert.equal(f.modelCalls(),6);
  assert.equal(row(f,'SELECT COUNT(*) AS n FROM swarm_smoke_control_claims').n,6);
  assert.equal(row(f,'SELECT coalesce(sum(reserved),0) AS n FROM swarm_budget_days').n,6);
  assert.equal((await f.controller.read()).phase,'RESTORE_REQUIRED');
  assert.equal((await runSixCallStep({store:f.controller,
   liveEvidence:f.liveEvidence,provider:f.provider,clock:()=>now+10})).status,'BLOCKED');
  assert.equal(f.modelCalls(),6);
  assert.equal(row(f,'PRAGMA integrity_check').integrity_check,'ok');
 }finally{f.sqlite.close();}
});
test('an unclaimed stage cannot write confirmed output or user-supplied bogus digest',async()=>{
 const f=setup();
 try{
  const text='検証済み第0段階',h=digest(text);
  const data={runId,taskReceiptId:receipt,stageIndex:0,claimRevision:1,
   digest:h,receiptId:'final_'+h.slice(0,40),text};
  await assert.rejects(()=>f.outputs.persistVerifiedOutput(data),
   /OUTPUT_INSERT_UNVERIFIED_NO_RETRY/);
  assert.equal(row(f,'SELECT COUNT(*) AS n FROM swarm_smoke_control_outputs').n,0);
  for(const patch of [
   {runId:'wrong'},{taskReceiptId:'wrong'},{stageIndex:6},
   {claimRevision:0},{digest:'a'.repeat(64)},
   {receiptId:'notmatch'},{text:'Z'.repeat(2401)}
  ]) await assert.rejects(()=>f.outputs.persistVerifiedOutput({...data,...patch}));
  assert.equal(row(f,'SELECT COUNT(*) AS n FROM swarm_smoke_control_outputs').n,0);
 }finally{f.sqlite.close();}
});
test('owner STOP following a claim prohibits saving result and forces UNKNOWN',async()=>{
 const f=setup();
 try{
  f.env.AI.run=async()=>{
   const stopped=await f.controller.requestStopOnce({
    runId,ownerId,nowMs:now+2
   });
   assert.equal(stopped.status,'STOP_RECORDED');
   return {response:'停止後に届いた未確定結果'};
  };
  const r=await runSixCallStep({store:f.controller,
   liveEvidence:f.liveEvidence,provider:f.provider,clock:()=>now+10});
  assert.equal(r.status,'UNKNOWN_STOP');
  assert.equal(row(f,'SELECT COUNT(*) AS n FROM swarm_smoke_control_outputs').n,0);
  assert.equal(row(f,'SELECT coalesce(sum(reserved),0) AS n FROM swarm_budget_days').n,1);
  assert.equal((await f.controller.read()).phase,'RESTORE_REQUIRED');
 }finally{f.sqlite.close();}
});
test('duplicate stage output cannot be inserted twice or inflate local budget',async()=>{
 const f=setup();
 try{
  const first=await runSixCallStep({store:f.controller,
   liveEvidence:f.liveEvidence,provider:f.provider,clock:()=>now+10});
  assert.equal(first.status,'STEP_COMPLETE');
  const h=digest('確認済み第1段階の出力');
  const again={runId,taskReceiptId:receipt,stageIndex:0,claimRevision:1,
   text:'確認済み第1段階の出力',digest:h,receiptId:'final_'+h.slice(0,40)};
  await assert.rejects(()=>f.outputs.persistVerifiedOutput(again));
  assert.equal(row(f,'SELECT COUNT(*) AS n FROM swarm_smoke_control_outputs').n,1);
  assert.equal(row(f,'SELECT coalesce(sum(reserved),0) AS n FROM swarm_budget_days').n,1);
 }finally{f.sqlite.close();}
});
test('prior stage must have FINAL_VERIFIED claim; pending or unknown cannot feed another stage',async()=>{
 const f=setup();
 try{
  await assert.rejects(()=>f.outputs.getLastConfirmedOutput({stageIndex:1}),
   /CONFIRMED_PRIOR_OUTPUT_MISSING/);
  assert.equal(await f.outputs.getLastConfirmedOutput({stageIndex:0}),'');
  await assert.rejects(()=>f.outputs.getLastConfirmedOutput({stageIndex:7}));
  const r=await runSixCallStep({store:f.controller,
   liveEvidence:f.liveEvidence,provider:f.provider,clock:()=>now+10});
  assert.equal(r.status,'STEP_COMPLETE');
  assert.equal(typeof(await f.outputs.getLastConfirmedOutput({stageIndex:1})),'string');
 }finally{f.sqlite.close();}
});
test('review-only schema adds one artifact table, no legacy UNKNOWN mutations',()=>{
 const f=setup();
 try{
  const old=f.sqlite.prepare('SELECT name FROM sqlite_master WHERE name LIKE ?').all('swarm_smoke_control_%');
  assert.ok(old.some(x=>x.name==='swarm_smoke_control_outputs'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM swarm_jobs').get().n,0);
  assert.equal(f.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const sql=readFileSync(new URL('./smoke-six-call-output-artifacts.review.sql',import.meta.url),'utf8');
  assert.match(sql,/OFFLINE REVIEW ONLY/);
  assert.doesNotMatch(sql,/\b(DROP|DELETE|UPDATE|INSERT|REPLACE)\s+(?:INTO|TABLE|FROM)?\s*swarm_jobs\b/i);
 }finally{f.sqlite.close();}
});
