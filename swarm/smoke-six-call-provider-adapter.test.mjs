import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
