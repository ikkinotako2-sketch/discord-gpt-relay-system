import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createDashboardSession,COMMAND_CENTER_ORIGIN} from '../command-center/server.mjs';
import {handleSmokeReviewedTaskRegister,SMOKE_REVIEW_TASK_REGISTER_PATH}
 from './smoke-six-call-owner-task-register.mjs';
import {FLAGS,DISCORD_SMOKE_TARGET as T} from './smoke-restore-guard.mjs';

const NOW=Date.UTC(2026,9,28,2,0,0);
const OWNER='123456789012345678';
const FOREIGN='999999999999999999';
const RUN='smoke_reviewed_task_20261028';
const RECEIPT='receipt_unique_20261028';
const URL=COMMAND_CENTER_ORIGIN+SMOKE_REVIEW_TASK_REGISTER_PATH;
const BASELINE='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const SMOKE='28c379e8-e759-4b2f-8300-e7a4c8b39b83';
const files=['schema.sql','smoke-six-call-d1-schema.review.sql',
 'smoke-six-call-owner-prepare-index.review.sql',
 'smoke-six-call-output-artifacts.review.sql',
 'smoke-six-call-owner-task-source.review.sql'];
const line=(sql)=>readFileSync(new URL('./'+sql,import.meta.url),'utf8');
async function setup(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of files)sqlite.exec(line(file));
 sqlite.prepare(`INSERT INTO swarm_smoke_control_runs(
  run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
  baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  RUN,OWNER,RECEIPT,T.accountId,T.worker,T.databaseId,BASELINE,SMOKE,
  'PENDING',NOW,NOW,NOW+19*60*1000);
 const db={prepare(sql){const stmt=sqlite.prepare(sql);
  return {bind(...p){return {
   first:async()=>stmt.get(...p)??null,run:async()=>stmt.run(...p)
  };}};}};
 const env={LOOP_DB:db,DISCORD_ALLOWED_USER_ID:OWNER,
  DASHBOARD_ENABLED:'true',SMOKE_OWNER_TASK_REGISTER_ENABLED:'true',
  DISCORD_OAUTH_CLIENT_SECRET:'offline-test-oauth-hmac-placeholder',
  DASHBOARD_COOKIE_KEY:'offline-test-hmac-cookie-placeholder',
  ...Object.fromEntries(FLAGS.map(k=>[k,'false']))
 };
 const cookie=await createDashboardSession(OWNER,env,NOW);
 const b64=cookie.split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
 const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64),x=>x.charCodeAt(0))));
 let callbacks=0;
 const reviewed=()=>({kind:'SERVER_REVIEWED_ORIGINAL_TASK',
  runId:RUN,ownerId:OWNER,taskReceiptId:RECEIPT,
  checkedAtMs:NOW,originalTask:'Discordの安全な六役割レビュー計画'});
 const deps={clock:()=>NOW+500,loadServerReviewedTask:async()=>{callbacks++;return reviewed();}};
 const request=({method='POST',body={intent:'REGISTER_REVIEW_ONLY_TASK',runId:RUN},
  headers={},url=URL}={})=>new Request(url,{method,headers:{
   Cookie:'dc_session='+cookie,Origin:COMMAND_CENTER_ORIGIN,
   'Content-Type':'application/json','X-CSRF-Token':payload.csrf,
   'Sec-Fetch-Site':'same-origin',...headers
  },...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
 const handle=(opts={},dep=deps,e=env)=>handleSmokeReviewedTaskRegister(request(opts),e,dep);
 const rows=()=>sqlite.prepare('SELECT * FROM swarm_smoke_control_owner_tasks').all();
 return {sqlite,db,env,request,handle,rows,reviewed,deps,callbacks:()=>callbacks};
}
test('signed owner OAuth+CSRF registers one immutable review-only task from server source',async()=>{
 const f=await setup();try{
  const response=await f.handle();
  assert.equal(response.status,202);
  const body=await response.json();
  assert.equal(body.status,'IMMUTABLE_OWNER_TASK_REVIEW_RECORDED_NO_LIVE_AUTHORITY');
  for(const key of ['authorizesInference','authorizesDeployment','authorizesD1Migration',
    'authorizesWatchdogArming','authorizesLiveActions'])
   assert.equal(body[key],false);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(f.rows().length,1);
  assert.equal(f.rows()[0].original_task,f.reviewed().originalTask);
  assert.equal(f.rows()[0].task_receipt_id,RECEIPT);
  assert.equal(f.callbacks(),1);
  assert.equal(f.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{f.sqlite.close();}
});
test('duplicate requests never replace owner task or change original review record',async()=>{
 const f=await setup();try{
  assert.equal((await f.handle()).status,202);
  const original=f.rows()[0];
  assert.equal((await f.handle()).status,503);
  assert.deepEqual(f.rows()[0],original);
  assert.equal(f.callbacks(),2);
 }finally{f.sqlite.close();}
});
test('client cannot pass task, owner, source, consent or 7-call override',async()=>{
 const f=await setup();try{
  for(const data of [
   {intent:'REGISTER_REVIEW_ONLY_TASK',runId:RUN,originalTask:'forged'},
   {intent:'REGISTER_REVIEW_ONLY_TASK',runId:RUN,ownerId:FOREIGN},
   {intent:'REGISTER_REVIEW_ONLY_TASK',runId:RUN,model:'@cf/paid'},
   {intent:'REGISTER_REVIEW_ONLY_TASK',runId:RUN,launch:true},
   {intent:'REGISTER_REVIEW_ONLY_TASK',runId:RUN,maxCalls:7},
   {intent:'EXECUTE_SIX_CALLS',runId:RUN},
   {intent:'REGISTER_REVIEW_ONLY_TASK',runId:'not valid !'},
   '{}','{bad json}',' '.repeat(257)
  ])assert.equal((await f.handle({body:data})).status,400);
  assert.equal(f.callbacks(),0);
  assert.equal(f.rows().length,0);
 }finally{f.sqlite.close();}
});
test('anonymous cookie, CSRF mismatch, wrong Origin, cross-site and bad content type fail',async()=>{
 const f=await setup();try{
  for(const [headers,status] of [
   [{Cookie:''},401],[{'X-CSRF-Token':'bad'},403],
   [{Origin:'https://attacker.invalid'},403],
   [{'Sec-Fetch-Site':'cross-site'},403],
   [{'Content-Type':'text/plain'},403]
  ])assert.equal((await f.handle({headers})).status,status);
  assert.equal(f.callbacks(),0);
  assert.equal(f.rows().length,0);
 }finally{f.sqlite.close();}
});
test('different path, query, GET and malformed body fail before any D1 insert',async()=>{
 const f=await setup();try{
  assert.equal((await f.handle({method:'GET'})).status,405);
  assert.equal((await f.handle({url:URL+'?debug=true'})).status,404);
  assert.equal((await f.handle({url:COMMAND_CENTER_ORIGIN+'/other'})).status,404);
  assert.equal((await f.handle({body:''})).status,400);
  assert.equal(f.callbacks(),0);
 }finally{f.sqlite.close();}
});
test('disabled default, missing D1 or any SWARM flag ON blocks',async()=>{
 const f=await setup();try{
  for(const patch of [
   {SMOKE_OWNER_TASK_REGISTER_ENABLED:'false'},
   {LOOP_DB:undefined},{SWARM_DAILY_CALL_CAP:'7'},
   ...FLAGS.map(flag=>({[flag]:'true'}))
  ])assert.equal((await f.handle({},f.deps,{...f.env,...patch})).status,503);
  assert.equal(f.callbacks(),0);assert.equal(f.rows().length,0);
 }finally{f.sqlite.close();}
});
test('wrong/missing/stale/unapproved server task cannot be registered',async()=>{
 const f=await setup();try{
  for(const patch of [
   {ownerId:FOREIGN},{runId:'wrong_task_run'},
   {taskReceiptId:'wrong_receipt'}, {kind:'UNTRUSTED_BROWSER_TASK'},
   {checkedAtMs:NOW-6*60*1000},
   {originalTask:''},{originalTask:'A'.repeat(1001)},
   {originalTask:'界'.repeat(801)}
  ]){
   const resp=await f.handle({},{
    ...f.deps,loadServerReviewedTask:async()=>({...f.reviewed(),...patch})
   });
   assert.equal(resp.status,503);
  }
  assert.equal(f.rows().length,0);
 }finally{f.sqlite.close();}
});
test('STOP, expired pending, wrong owner or already ACTIVE cannot create task',async()=>{
 for(const sql of [
  "UPDATE swarm_smoke_control_runs SET stop_requested=1",
  "UPDATE swarm_smoke_control_runs SET phase='ACTIVE'",
  "UPDATE swarm_smoke_control_runs SET attempts=1",
  "UPDATE swarm_smoke_control_runs SET owner_id='999999999999999999'",
  `UPDATE swarm_smoke_control_runs SET expires_at_ms=${NOW+100}`
 ]){
  const f=await setup();try{
   f.sqlite.exec(sql);
   assert.equal((await f.handle()).status,409);
   assert.equal(f.callbacks(),0);assert.equal(f.rows().length,0);
  }finally{f.sqlite.close();}
 }
});
test('concurrent request race admits exactly one immutable task, other is no-retry error',async()=>{
 const f=await setup();try{
  const outputs=await Promise.all([f.handle(),f.handle()]);
  assert.deepEqual(outputs.map(x=>x.status).sort(),[202,503]);
  assert.equal(f.rows().length,1);
 }finally{f.sqlite.close();}
});
test('pending run changed to STOP during asynchronous review is refused by INSERT CAS',async()=>{
 const f=await setup();try{
  const resp=await f.handle({},{
   ...f.deps,loadServerReviewedTask:async()=>{
    f.sqlite.exec("UPDATE swarm_smoke_control_runs SET stop_requested=1");
    return f.reviewed();
   }
  });
  assert.equal(resp.status,503);assert.equal(f.rows().length,0);
 }finally{f.sqlite.close();}
});
test('missing actual task schema or ambiguous D1 read does not use a retry',async()=>{
 const f=await setup();try{
  f.sqlite.exec('DROP TRIGGER swarm_smoke_control_owner_task_scope');
  f.sqlite.exec('DROP TRIGGER swarm_smoke_control_owner_task_no_update');
  f.sqlite.exec('DROP TRIGGER swarm_smoke_control_owner_task_no_delete');
  f.sqlite.exec('DROP TABLE swarm_smoke_control_owner_tasks');
  assert.equal((await f.handle()).status,503);
  assert.equal(f.callbacks(),1);
 }finally{f.sqlite.close();}
});
test('old UNKNOWN job and daily reservation unchanged after new owner task registration',async()=>{
 const f=await setup();try{
  f.sqlite.prepare(`INSERT INTO swarm_jobs(
   run_id,owner_id,task,cycles,status,calls_used,last_error,
   created_at,updated_at,expires_at) VALUES(?,?,?,1,'unknown',1,?,?,?,?)`)
  .run('historic_unknown_20261024',OWNER,'untouched job',
   'MODEL_OUTCOME_UNKNOWN',NOW-5000,NOW-4000,NOW+100000);
  const old=f.sqlite.prepare('SELECT * FROM swarm_jobs').get();
  assert.equal((await f.handle()).status,202);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM swarm_jobs').get(),old);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM swarm_budget_days').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM swarm_smoke_control_claims').get().n,0);
 }finally{f.sqlite.close();}
});
test('new staged module never imports live Worker and has no model, billing or deploy endpoint',()=>{
 const code=readFileSync(new URL('./smoke-six-call-owner-task-register.mjs',import.meta.url),'utf8');
 for(const rel of ['../worker-relay.mjs','../worker-loop.mjs','./api.mjs','./cron.mjs']){
  const text=readFileSync(new URL(rel,import.meta.url),'utf8');
  assert.equal(text.includes('smoke-six-call-owner-task-register'),false,rel);
 }
 for(const token of ['env.AI.run','wrangler deploy','fetch(', 'prepaidCredit',
  'D1_MIGRATION_APPLY','swarm_jobs SET','UPDATE swarm_jobs'])
  assert.equal(code.includes(token),false,token);
});
