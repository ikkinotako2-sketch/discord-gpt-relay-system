import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createD1SixCallStore} from './smoke-six-call-d1-store.mjs';
import {runSixCallStep} from './smoke-six-call-controller.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
import {createStagedSixCallAIProvider,sixCallRoleMessages,
 SIX_CALL_OUTPUT_TOKEN_LIMIT,SIX_CALL_ROLE_COUNT}
 from './smoke-six-call-provider-adapter.mjs';
import {ROLES} from './engine.mjs';
import {FLAGS} from './smoke-restore-guard.mjs';
import {GPT_OSS_MODEL} from '../loop-quality.mjs';

const now=Date.UTC(2026,9,27,13,0,0);
const expiry=now+19*60*1000;
const runId='smoke_prod_boundary_20261027';
const receipt='reviewed_owner_receipt_20261027';
const ownerId='123456789012345678';
const request=i=>({runId,taskReceiptId:receipt,stageIndex:i,
 claimRevision:i*2+1});
function settings(){
 return {
  SMOKE_AI_PROVIDER_ENABLED:'true',SWARM_DAILY_CALL_CAP:'6',
  SMOKE_PINNED_MODEL:GPT_OSS_MODEL,SWARM_SMOKE_EXPIRES_AT:String(expiry),
  DISCORD_ALLOWED_USER_ID:ownerId,
  ...Object.fromEntries(FLAGS.map(x=>[x,'true']))
 };
}
function fixture({
 result={response:'検証済みの日本語テキスト'},
 mutateEnv=()=>{},
 mutateJob=()=>{},
 mutateReceipt=()=>{},
 throwAI=false,throwPersist=false,clock=()=>now
}={}){
 const events=[],env=settings();
 env.AI={run:async(model,payload)=>{
  events.push({kind:'AI',model,payload});
  if(throwAI)throw Error('UNVERIFIED_PROVIDER_OUTCOME');
  return result;
 }};
 mutateEnv(env);
 const loadVerifiedTask=async claim=>{
  events.push({kind:'LOAD',claim});
  const task={
   source:'SERVER_D1_VERIFIED_OWNER_TASK',
   runId:claim.runId,taskReceiptId:claim.taskReceiptId,
   stageIndex:claim.stageIndex,claimRevision:claim.claimRevision,
   ownerId,expiryMs:expiry,checkedAtMs:now,
   previousStageFinalVerified:true,legacyHistoricalUnknownImmutable:true,
   originalTask:'Discordサーバーの安全な管理計画を作る',
   previousConfirmedOutput:'前の役割で確定した参考資料',
  };
  mutateJob(task);
  return task;
 };
 const persistVerifiedOutput=async data=>{
  events.push({kind:'SAVE',data});
  if(throwPersist)throw Error('AMBIGUOUS_D1_COMMIT');
  return {...data,saved:true,...mutateReceipt(data)};
 };
 const provider=createStagedSixCallAIProvider({
  env,loadVerifiedTask,persistVerifiedOutput,clock
 });
 return {events,env,provider};
}
test('the six exact server-pinned roles and 360 max output tokens are fixed',()=>{
 assert.equal(ROLES.length,6);
 assert.equal(SIX_CALL_ROLE_COUNT,6);
 assert.equal(SIX_CALL_OUTPUT_TOKEN_LIMIT,360);
 for(let i=0;i<6;i++){
  const m=sixCallRoleMessages({
   stageIndex:i,originalTask:'安全な設計',
   previousConfirmedOutput:'不信頼の参考'
  });
  assert.equal(m[0].role,'system');
  assert.ok(m[0].content.includes(ROLES[i].label));
  assert.equal(m[1].role,'user');
  assert.equal(m[1].content.includes('不信頼の参考'),true);
 }
});
test('one fake AI call writes exactly one bounded verified final receipt',async()=>{
 const f=fixture();
 const x=await f.provider.invoke(request(0));
 assert.equal(x.status,'FINAL_VERIFIED');
 assert.equal(x.stageIndex,0);
 assert.match(x.receiptId,/^final_[a-f0-9]{40}$/);
 assert.deepEqual(f.events.map(e=>e.kind),['LOAD','AI','SAVE']);
 const ai=f.events[1];
 assert.equal(ai.model,GPT_OSS_MODEL);
 assert.equal(ai.payload.max_tokens,360);
 assert.equal(ai.payload.reasoning_effort,'low');
 assert.equal(ai.payload.temperature,0.2);
 assert.equal(ai.payload.messages.length,2);
 assert.equal(f.events[2].data.text,'検証済みの日本語テキスト');
 assert.equal(f.events[2].data.receiptId,x.receiptId);
});
test('exactly six roles never accept a seventh stage',async()=>{
 const f=fixture();
 for(let i=0;i<6;i++)assert.equal((await f.provider.invoke(request(i))).status,'FINAL_VERIFIED');
 await assert.rejects(()=>f.provider.invoke(request(6)),/INVALID_CLAIM_IDENTITY/);
 assert.equal(f.events.filter(x=>x.kind==='AI').length,6);
});
test('flags OFF, missing AI binding, plan, pinned model, expiry stop before a model',async()=>{
 const patches=[
  e=>e.SMOKE_AI_PROVIDER_ENABLED='false',
  e=>e.SWARM_DAILY_CALL_CAP='7',
  e=>e.SMOKE_PINNED_MODEL='@cf/other/model',
  e=>e.SWARM_SMOKE_EXPIRES_AT=String(now-1),
  e=>e.SWARM_SMOKE_EXPIRES_AT=String(now+21*60*1000),
  e=>e.SWARM_SMOKE_EXPIRES_AT='not-a-date',
  e=>e.DISCORD_ALLOWED_USER_ID='attacker',
  e=>delete e.AI
 ];
 for(const patch of patches){
  const f=fixture({mutateEnv:patch});
  await assert.rejects(()=>f.provider.invoke(request(0)),
   /SMOKE_PROVIDER_NOT_EXPLICITLY_ENABLED/);
  assert.equal(f.events.length,0);
 }
 for(const flag of FLAGS){
  const f=fixture({mutateEnv:e=>e[flag]='false'});
  await assert.rejects(()=>f.provider.invoke(request(0)));
  assert.equal(f.events.length,0);
 }
});
test('malformed/replaced/non-owner task receipt never causes AI inference',async()=>{
 const mutations=[
  x=>x.source='BROWSER_JSON',
  x=>x.runId='another_run',
  x=>x.taskReceiptId='another_receipt',
  x=>x.stageIndex=5,
  x=>x.claimRevision=17,
  x=>x.ownerId='999999999999999999',
  x=>x.expiryMs=expiry+1,
  x=>x.checkedAtMs=now-31000,
  x=>x.previousStageFinalVerified=false,
  x=>x.legacyHistoricalUnknownImmutable=false,
  x=>x.originalTask='',
  x=>x.originalTask='T'.repeat(1001),
  x=>x.previousConfirmedOutput='R'.repeat(1001)
 ];
 for(const mutateJob of mutations){
  const f=fixture({mutateJob});
  await assert.rejects(()=>f.provider.invoke(request(0)),/TRUSTED_D1_TASK_RECEIPT_UNVERIFIED/);
  assert.equal(f.events.filter(x=>x.kind==='AI').length,0);
 }
});
test('provider error is propagated for controller to settle as UNKNOWN, no retry',async()=>{
 const f=fixture({throwAI:true});
 await assert.rejects(()=>f.provider.invoke(request(0)),/UNVERIFIED_PROVIDER_OUTCOME/);
 assert.deepEqual(f.events.map(x=>x.kind),['LOAD','AI']);
});
test('oversized or empty final output fails without storing result',async()=>{
 for(const result of [
  {response:''},{response:' '},{response:'日本語'.repeat(1000)},
  {choices:[{message:{content:'X'.repeat(2401)}}]},
  {output:[{type:'reasoning',content:[{text:'not final'}]}]}
 ]){
  const f=fixture({result});
  await assert.rejects(()=>f.provider.invoke(request(0)));
  assert.equal(f.events.filter(x=>x.kind==='AI').length,1);
  assert.equal(f.events.filter(x=>x.kind==='SAVE').length,0);
 }
});
test('lost or forged final D1 receipt cannot be counted as confirmed',async()=>{
 for(const mutateReceipt of [
  d=>({saved:false}),d=>({digest:'bad'}),
  d=>({runId:'wrong'}),d=>({stageIndex:5}),
  d=>({claimRevision:999}),d=>({taskReceiptId:'bad'}),
  d=>({receiptId:'unrelated'})
 ]){
  const f=fixture({mutateReceipt});
  await assert.rejects(()=>f.provider.invoke(request(0)),/FINAL_OUTPUT_PERSISTENCE_NOT_VERIFIED/);
  assert.equal(f.events.filter(x=>x.kind==='AI').length,1);
 }
 const f=fixture({throwPersist:true});
 await assert.rejects(()=>f.provider.invoke(request(0)),/AMBIGUOUS_D1_COMMIT/);
 assert.equal(f.events.filter(x=>x.kind==='AI').length,1);
});
test('reject malformed invoke claims and any untrusted extra argument',async()=>{
 const malformed=[
  {...request(0),admin:true},
  {...request(0),runId:'bad'},
  {...request(0),stageIndex:-1},
  {...request(0),stageIndex:6},
  {...request(0),claimRevision:0},
  {...request(0),taskReceiptId:null},
  {},
 ];
 for(const args of malformed){
  const f=fixture();
  await assert.rejects(()=>f.provider.invoke(args),/INVALID_CLAIM_IDENTITY/);
  assert.equal(f.events.length,0);
 }
});
test('asynchronous D1 checkedAt after provider entry is valid only before post-load clock',async()=>{
 // This represents a normal awaited D1 SELECT: provider entry at t=0,
 // owner task read and verified at t=100ms, post-load pre-AI gate at t=120ms.
 // The old implementation compared the D1 stamp to t=0, wrongly denied it.
 let ticks=0;
 const f=fixture({
  clock:()=>++ticks===1?now:now+120,
  mutateJob:x=>x.checkedAtMs=now+100
 });
 const outcome=await f.provider.invoke(request(0));
 assert.equal(outcome.status,'FINAL_VERIFIED');
 assert.deepEqual(f.events.map(x=>x.kind),['LOAD','AI','SAVE']);
 assert.equal(ticks,2);
});
test('future D1 timestamp relative to post-load clock fails without AI',async()=>{
 let ticks=0;
 const f=fixture({
  clock:()=>++ticks===1?now:now+120,
  mutateJob:x=>x.checkedAtMs=now+121
 });
 await assert.rejects(()=>f.provider.invoke(request(0)),
  /TRUSTED_D1_TASK_RECEIPT_UNVERIFIED/);
 assert.deepEqual(f.events.map(x=>x.kind),['LOAD']);
});
test('slow asynchronous D1 read beyond 30 seconds fails even with a fresh returned stamp',async()=>{
 let ticks=0;
 const f=fixture({
  clock:()=>++ticks===1?now:now+31000,
  mutateJob:x=>x.checkedAtMs=now+30999
 });
 await assert.rejects(()=>f.provider.invoke(request(0)),
  /PROVIDER_WINDOW_EXPIRED_OR_CHANGED/);
 assert.deepEqual(f.events.map(x=>x.kind),['LOAD']);
});
test('two-step clock drift and expired provider window prevent AI',async()=>{
 for(const second of [now-1,expiry,now+31*1000]){
  let n=0;
  const f=fixture({clock:()=>++n===1?now:second});
  await assert.rejects(()=>f.provider.invoke(request(0)),/PROVIDER_WINDOW_EXPIRED_OR_CHANGED/);
  assert.equal(f.events.filter(x=>x.kind==='AI').length,0);
 }
});
test('missing real task loader or D1 output persister fails closed',async()=>{
 for(const props of [{},{loadVerifiedTask:async()=>({})},{persistVerifiedOutput:async()=>({})}]){
  const p=createStagedSixCallAIProvider({env:settings(),...props});
  await assert.rejects(()=>p.invoke(request(0)),/TRUSTED_RUNTIME_CAPABILITIES_MISSING/);
 }
});
test('no live Worker imports this adapter and it cannot mutate Cloudflare',()=>{
 const content=readFileSync(new URL('./smoke-six-call-provider-adapter.mjs',import.meta.url),'utf8');
 const prodFiles=['../worker-relay.mjs','../worker-loop.mjs','./cron.mjs','./api.mjs'];
 for(const rel of prodFiles){
  const s=readFileSync(new URL(rel,import.meta.url),'utf8');
  assert.equal(s.includes('smoke-six-call-provider-adapter'),false,rel);
 }
 assert.equal(content.includes('fetch('),false);
 assert.equal(content.includes('wrangler'),false);
 assert.equal(content.includes('secrets.'),false);
});

test('end-to-end LOCAL SQLite controller -> staged fake GPT-OSS -> six receipts -> restore only',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of ['schema.sql','smoke-six-call-d1-schema.review.sql',
   'smoke-six-call-owner-prepare-index.review.sql'])
   sqlite.exec(readFileSync(new URL('./'+name,import.meta.url),'utf8'));
  sqlite.exec('CREATE TABLE local_verified_artifacts (stage_index INTEGER PRIMARY KEY, digest TEXT NOT NULL, output TEXT NOT NULL)');
  const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
  const smoke='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
  sqlite.prepare(`INSERT INTO swarm_smoke_control_runs(
    run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
    baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,ownerId,receipt,
    DISCORD_SMOKE_TARGET.accountId,DISCORD_SMOKE_TARGET.worker,
    DISCORD_SMOKE_TARGET.databaseId,baseline,smoke,'ACTIVE',now,now,expiry);
  const db={prepare(q){const statement=sqlite.prepare(q);
   return {bind(...args){return {
    first:async()=>statement.get(...args)??null,
    run:async()=>statement.run(...args)
   };}};}};
  const store=createD1SixCallStore({db,runId});
  let calls=0;
  const env=settings();
  env.AI={run:async(model,input)=>{
   assert.equal(model,GPT_OSS_MODEL);
   assert.equal(input.max_tokens,360);
   calls++;
   return {response:'承認済みローカルテスト役割 '+calls};
  }};
  const provider=createStagedSixCallAIProvider({
   env,clock:()=>now+100,
   loadVerifiedTask:async details=>{
    const previous=sqlite.prepare('SELECT output FROM local_verified_artifacts WHERE stage_index=?').get(details.stageIndex-1);
    return {
     ...details,source:'SERVER_D1_VERIFIED_OWNER_TASK',
     ownerId,expiryMs:expiry,checkedAtMs:now,
     previousStageFinalVerified:details.stageIndex===0||!!previous,
     legacyHistoricalUnknownImmutable:true,
     originalTask:'Discordサーバーの安全な管理方針',
     previousConfirmedOutput:previous?.output||''
    };
   },
   persistVerifiedOutput:async data=>{
    sqlite.prepare('INSERT INTO local_verified_artifacts (stage_index,digest,output) VALUES(?,?,?)')
      .run(data.stageIndex,data.digest,data.text);
    const row=sqlite.prepare('SELECT digest,output FROM local_verified_artifacts WHERE stage_index=?')
      .get(data.stageIndex);
    return {...data,saved:row.digest===data.digest&&row.output===data.text};
   }
  });
  const liveEvidence={collect:async()=>{
   const state=await store.read();
   return {
    status:'VERIFIED_FROM_TRUSTED_ADAPTER',checkedAtMs:now,target:DISCORD_SMOKE_TARGET,
    runId,taskReceiptId:receipt,activeVersion:smoke,baselineVersion:baseline,
    expiresAtMs:expiry,ownerOauthCsrfVerified:true,
    newExplicitOwnerConsentVerified:true,watchdogIndependentlyPrearmed:true,
    watchdogLiveRestoreTested:true,releaseLockFencingVerified:true,
    remoteFourFlagsEnabledAndBounded:true,d1HistoryUnknownExactlyPreserved:true,
    legacyActiveJobs:0,otherSixRoleJobs:0,pendingStopJobs:0,
    accountPlanFreeVerified:true,modelAvailableVerified:true,
    accountWideSixCallsFreeMarginVerified:true,unrelatedAiIdleVerified:true,
    githubActiveReleaseRuns:0,emergencyStopReachable:true
   };
  }};
  const statuses=[];
  for(let i=0;i<6;i++){
   const result=await runSixCallStep({store,liveEvidence,provider,clock:()=>now+101});
   statuses.push(result.status);
   assert.equal(result.attempts,i+1);
   assert.equal(result.completed,i+1);
  }
  assert.deepEqual(statuses,[
   'STEP_COMPLETE','STEP_COMPLETE','STEP_COMPLETE',
   'STEP_COMPLETE','STEP_COMPLETE','SIX_CALL_LIMIT_REACHED'
  ]);
  assert.equal(calls,6);
  const rows=sqlite.prepare('SELECT count(*) AS n FROM local_verified_artifacts').get().n;
  assert.equal(rows,6);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM swarm_smoke_control_claims').get().n,6);
  assert.equal(sqlite.prepare('SELECT coalesce(sum(reserved),0) AS n FROM swarm_budget_days').get().n,6);
  assert.equal((await store.read()).phase,'RESTORE_REQUIRED');
  assert.equal((await runSixCallStep({store,liveEvidence,provider,clock:()=>now+101})).status,'BLOCKED');
  assert.equal(calls,6);
 }finally{sqlite.close();}
});
