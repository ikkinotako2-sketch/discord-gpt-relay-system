import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createStagedD1OwnerTaskReader} from './smoke-six-call-owner-task-source.mjs';
import {createStagedD1SixCallOutputStore} from './smoke-six-call-output-d1.mjs';
import {createStagedSixCallAIProvider} from './smoke-six-call-provider-adapter.mjs';
import {createD1SixCallStore} from './smoke-six-call-d1-store.mjs';
import {runSixCallStep} from './smoke-six-call-controller.mjs';
import {DISCORD_SMOKE_TARGET as T,FLAGS} from './smoke-restore-guard.mjs';
import {GPT_OSS_MODEL} from '../loop-quality.mjs';

const now=Date.UTC(2026,9,28,2,0);
const expires=now+19*60*1000;
const runId='smoke_owner_task_evidence_20261028';
const receipt='owner_receipt_20261028';
const ownerId='123456789012345678';
const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smoke='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
function setup({unknownStatus='ORIGINAL_UNKNOWN_FINGERPRINT_VERIFIED'}={}){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');
 for(const path of ['schema.sql','smoke-six-call-d1-schema.review.sql',
  'smoke-six-call-owner-prepare-index.review.sql',
  'smoke-six-call-output-artifacts.review.sql',
  'smoke-six-call-owner-task-source.review.sql'])
  sql.exec(readFileSync(new URL('./'+path,import.meta.url),'utf8'));
 sql.prepare(`INSERT INTO swarm_smoke_control_runs
 (run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(runId,ownerId,receipt,T.accountId,T.worker,T.databaseId,
   baseline,smoke,'PENDING',now,now,expires);
 sql.prepare(`INSERT INTO swarm_smoke_control_owner_tasks(
 run_id,owner_id,task_receipt_id,original_task,created_at_ms)
 VALUES(?,?,?,?,?)`).run(runId,ownerId,receipt,'Discord管理システムの本番安全計画',now);
 sql.prepare("UPDATE swarm_smoke_control_runs SET phase='ACTIVE' WHERE run_id=?").run(runId);
 const db={prepare(q){const stmt=sql.prepare(q);return {
  bind(...params){return {
   first:async()=>stmt.get(...params)??null,
   run:async()=>stmt.run(...params)
  };}};}};
 const store=createD1SixCallStore({db,runId});
 const output=createStagedD1SixCallOutputStore({db,runId,ownerId,clock:()=>now+15});
 let historicalChecks=0,modelCalls=0;
 const historicalUnknownVerifier=async target=>{
  historicalChecks++;
  return {status:unknownStatus,accountId:target.accountId,
   databaseId:target.databaseId,checkedAtMs:now+10};
 };
 const ownerReader=createStagedD1OwnerTaskReader({
  db,runId,ownerId,historicalUnknownVerifier,clock:()=>now+11
 });
 const env={
  SMOKE_AI_PROVIDER_ENABLED:'true',SWARM_DAILY_CALL_CAP:'6',
  SMOKE_PINNED_MODEL:GPT_OSS_MODEL,SWARM_SMOKE_EXPIRES_AT:String(expires),
  DISCORD_ALLOWED_USER_ID:ownerId,...Object.fromEntries(FLAGS.map(x=>[x,'true'])),
  AI:{run:async()=>({response:'第'+(++modelCalls)+'段階の確認済み結果'})}
 };
 const provider=createStagedSixCallAIProvider({
  env,loadVerifiedTask:ownerReader.loadVerifiedTask,
  persistVerifiedOutput:output.persistVerifiedOutput,clock:()=>now+12
 });
 const liveEvidence={collect:async()=>({
  status:'VERIFIED_FROM_TRUSTED_ADAPTER',checkedAtMs:now+10,target:T,
  runId,taskReceiptId:receipt,activeVersion:smoke,baselineVersion:baseline,
  expiresAtMs:expires,ownerOauthCsrfVerified:true,
  newExplicitOwnerConsentVerified:true,watchdogIndependentlyPrearmed:true,
  watchdogLiveRestoreTested:true,releaseLockFencingVerified:true,
  remoteFourFlagsEnabledAndBounded:true,d1HistoryUnknownExactlyPreserved:true,
  legacyActiveJobs:0,otherSixRoleJobs:0,pendingStopJobs:0,
  accountPlanFreeVerified:true,modelAvailableVerified:true,
  accountWideSixCallsFreeMarginVerified:true,unrelatedAiIdleVerified:true,
  githubActiveReleaseRuns:0,emergencyStopReachable:true
 })};
 return {sql,db,store,output,ownerReader,liveEvidence,provider,env,
  unknownChecks:()=>historicalChecks,modelCalls:()=>modelCalls};
}
test('the future owner task is inserted only while same owner PENDING, then immutable',()=>{
 const f=setup();
 try{
  assert.throws(()=>f.sql.prepare(
   "UPDATE swarm_smoke_control_owner_tasks SET original_task='attacker'").run(),
   /OWNER_TASK_IMMUTABLE_NO_UPDATE/);
  assert.throws(()=>f.sql.prepare(
   'DELETE FROM swarm_smoke_control_owner_tasks').run(),
   /OWNER_TASK_IMMUTABLE_NO_DELETE/);
  assert.throws(()=>f.sql.prepare(
   "INSERT INTO swarm_smoke_control_owner_tasks VALUES(?,?,?,?,?)")
   .run('other_run','123456789012345678','extra_receipt','inject',now),
   /FOREIGN KEY|OWNER_TASK_NOT_PINNED_PENDING_RUN/);
  assert.equal(f.sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{f.sql.close();}
});
test('real SQLite end-to-end original D1 owner task -> six fake AI -> six outputs -> seventh blocked',async()=>{
 const f=setup();
 try{
  for(let i=0;i<6;i++){
   const result=await runSixCallStep({store:f.store,
    liveEvidence:f.liveEvidence,provider:f.provider,clock:()=>now+13});
   assert.equal(result.status,i===5?'SIX_CALL_LIMIT_REACHED':'STEP_COMPLETE');
   assert.equal(result.completed,i+1);
  }
  assert.equal(f.modelCalls(),6);
  assert.equal(f.unknownChecks(),6);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM swarm_smoke_control_outputs').get().n,6);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM swarm_smoke_control_claims').get().n,6);
  assert.equal(f.sql.prepare('SELECT sum(reserved) n FROM swarm_budget_days').get().n,6);
  assert.equal((await f.store.read()).phase,'RESTORE_REQUIRED');
  assert.equal((await runSixCallStep({store:f.store,liveEvidence:f.liveEvidence,
   provider:f.provider,clock:()=>now+13})).status,'BLOCKED');
  assert.equal(f.modelCalls(),6);
 }finally{f.sql.close();}
});
test('historical UNKNOWN is independently required; fake approval never becomes verified task',async()=>{
 const f=setup({unknownStatus:'OWNER_APPROVED_ONLY'});
 try{
  const result=await runSixCallStep({store:f.store,
   liveEvidence:f.liveEvidence,provider:f.provider,clock:()=>now+13});
  assert.equal(result.status,'UNKNOWN_STOP');
  assert.equal(f.modelCalls(),0);
  assert.equal(f.unknownChecks(),1);
  assert.equal(f.sql.prepare('SELECT sum(reserved) n FROM swarm_budget_days').get().n,1);
 }finally{f.sql.close();}
});
test('missing external UNKNOWN-verifier fails construction, never reads task',()=>{
 const f=setup();
 try{
  assert.throws(()=>createStagedD1OwnerTaskReader({db:f.db,runId,ownerId}),
   /TRUSTED_OWNER_TASK_DEPENDENCIES_MISSING/);
 }finally{f.sql.close();}
});
test('STOP after claim before owner task lookup blocks the provider and consumes reserved attempt',async()=>{
 const f=setup();
 try{
  const original=f.ownerReader.loadVerifiedTask;
  let once=false;
  const provider=createStagedSixCallAIProvider({
   env:f.env,clock:()=>now+12,
   loadVerifiedTask:async request=>{
    if(!once){once=true;await f.store.requestStopOnce({runId,ownerId,nowMs:now+10});}
    return original(request);
   },
   persistVerifiedOutput:f.output.persistVerifiedOutput
  });
  const result=await runSixCallStep({store:f.store,
   liveEvidence:f.liveEvidence,provider,clock:()=>now+13});
  assert.equal(result.status,'UNKNOWN_STOP');
  assert.equal(f.modelCalls(),0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM swarm_smoke_control_outputs').get().n,0);
 }finally{f.sql.close();}
});
test('missing previous verified final or untrusted/tampered stage output blocks role 2',async()=>{
 const f=setup();
 try{
  // Simulate the durable role-2 claim without a prior output. Local-only.
  const t=f.sql;
  t.prepare('UPDATE swarm_smoke_control_runs SET attempts=1,completed=1,revision=2 WHERE run_id=?').run(runId);
  const claim=await f.store.claimOnce({runId,expectedRevision:2,index:1,
   expectedExpiryMs:expires,nowMs:now+1,localDailyCap:6});
  assert.equal(claim.claimed,true);
  await assert.rejects(()=>f.ownerReader.loadVerifiedTask({
   runId,taskReceiptId:receipt,stageIndex:1,claimRevision:3
  }),/PRIOR_FINAL_OUTPUT_UNVERIFIED/);
 }finally{f.sql.close();}
});
test('read-only owner task module cannot deploy Worker or invoke model',()=>{
 const s=readFileSync(new URL('./smoke-six-call-owner-task-source.mjs',import.meta.url),'utf8');
 for(const str of ['fetch(', 'wrangler', 'env.AI', 'process.env', 'INSERT INTO', 'UPDATE swarm_']){
  assert.equal(s.includes(str),false,str);
 }
 const prod=readFileSync(new URL('../worker-relay.mjs',import.meta.url),'utf8');
 assert.equal(prod.includes('smoke-six-call-owner-task-source'),false);
});
