import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createDashboardSession,COMMAND_CENTER_ORIGIN} from '../command-center/server.mjs';
import {handleSmokeOwnerStop,SMOKE_OWNER_STOP_PATH} from './smoke-six-call-owner-stop.mjs';
import {DISCORD_SMOKE_TARGET as T} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,26,10,0);
const run='smoke_stop_owner_2026',owner='123456789012345678';
const URL_STOP=COMMAND_CENTER_ORIGIN+SMOKE_OWNER_STOP_PATH;
async function setup({phase='ACTIVE'}={}){
 const sqlite=new DatabaseSync(':memory:');
 for(const f of ['schema.sql','smoke-six-call-d1-schema.review.sql',
   'smoke-six-call-owner-prepare-index.review.sql'])
  sqlite.exec(readFileSync(new URL('./'+f,import.meta.url),'utf8'));
 sqlite.prepare(`INSERT INTO swarm_smoke_control_runs
 (run_id,owner_id,task_receipt_id,account_id,worker_name,database_id,
 baseline_version,smoke_version,phase,created_at_ms,updated_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(run,owner,'owner_receipt_for_stop',T.accountId,
  T.worker,T.databaseId,'18c379e8-e759-4b2f-8300-e7a4c8b39b83',
  '28c379e8-e759-4b2f-8300-e7a4c8b39b83',phase,now,now,now+19*60000);
 const db={prepare(sql){
  const stmt=sqlite.prepare(sql);return{bind(...args){return{
   first:async()=>stmt.get(...args)??null,
   run:async()=>stmt.run(...args)
  };}};
 }};
 const env={LOOP_DB:db,DISCORD_ALLOWED_USER_ID:owner,
  DISCORD_OAUTH_CLIENT_SECRET:'offline_secret_for_crypto_fixture_only',
  DASHBOARD_COOKIE_KEY:'offline_cookie_key_for_crypto_fixture_only',
  DASHBOARD_ENABLED:'true',SMOKE_OWNER_STOP_ENABLED:'true',
  SWARM_RUNNER_ENABLED:'false',SWARM_EXECUTION_APPROVED:'false',
  SWARM_API_ENABLED:'false',SWARM_EXCLUSIVE_MODE:'false'};
 const cookie=await createDashboardSession(owner,env,now);
 const [encoded]=cookie.split('.');
 const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(
  atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0))));
 const fixture={sqlite,env,cookie,csrf:payload.csrf};
 return fixture;
}
const row=f=>f.sqlite.prepare('SELECT * FROM swarm_smoke_control_runs WHERE run_id=?').get(run);
function req(f,{url=URL_STOP,headers={},body={intent:'STOP_SIX_CALL_NO_NEW_ATTEMPTS',runId:run},method='POST'}={}){
 const h={Cookie:'dc_session='+f.cookie,Origin:COMMAND_CENTER_ORIGIN,
  'X-CSRF-Token':f.csrf,'Content-Type':'application/json',
  'Sec-Fetch-Site':'same-origin',...headers};
 return new Request(url,{method,headers:h,
  ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
const stop=(f,override)=>handleSmokeOwnerStop(req(f,override),f.env,{clock:()=>now+100});

test('authenticated owner STOP works even with all runner execution flags OFF',async()=>{
 const f=await setup();try{
  const response=await stop(f);const p=await response.json();
  assert.equal(response.status,202);
  assert.equal(p.status,'STOP_DURABLY_RECORDED');
  assert.equal(p.authorizesInference,false);assert.equal(p.remoteBaselineRestored,false);
  assert.equal(p.independentRollbackVerificationRequired,true);
  assert.equal(row(f).phase,'RESTORE_REQUIRED');
  assert.equal(row(f).stop_requested,1);
  assert.equal(row(f).attempts,0);
 }finally{f.sqlite.close();}
});
test('STOP is once-only; repeated request cannot increment revision',async()=>{
 const f=await setup();try{
  assert.equal((await stop(f)).status,202);
  assert.equal((await stop(f)).status,409);
  assert.equal(row(f).revision,1);
 }finally{f.sqlite.close();}
});
test('STOP does not need separate AI execution permission, even when flags ON',async()=>{
 const f=await setup();try{
  f.env.SWARM_RUNNER_ENABLED='true';f.env.SWARM_EXECUTION_APPROVED='true';
  assert.equal((await stop(f)).status,202);
  assert.equal(row(f).stop_requested,1);
 }finally{f.sqlite.close();}
});
test('forged, missing, expired signed-cookie session cannot STOP',async()=>{
 const f=await setup();try{
  for(const headers of [{Cookie:''},{Cookie:'dc_session=fake.signature'},
   {Cookie:'dc_session='+f.cookie.slice(0,-1)+(f.cookie.endsWith('Z')?'Y':'Z')}])
   assert.equal((await stop(f,{headers})).status,401);
  const expired=await handleSmokeOwnerStop(req(f),f.env,
   {clock:()=>now+61*60000});
  assert.equal(expired.status,401);
  assert.equal(row(f).stop_requested,0);
 }finally{f.sqlite.close();}
});
test('CSRF, wrong origin, fetch-site and content type all reject',async()=>{
 const f=await setup();try{
  for(const headers of [
   {'X-CSRF-Token':''},{'X-CSRF-Token':'spoof'},
   {'Origin':'https://attacker.invalid'},
   {'Sec-Fetch-Site':'cross-site'},
   {'Content-Type':'text/plain'}
  ])assert.equal((await stop(f,{headers})).status,403);
  assert.equal(row(f).stop_requested,0);
 }finally{f.sqlite.close();}
});
test('caller cannot supply owner, admin, model, restore flags or other endpoint',async()=>{
 const f=await setup();try{
  for(const body of [
   {intent:'STOP_SIX_CALL_NO_NEW_ATTEMPTS',runId:run,ownerId:owner},
   {intent:'STOP_SIX_CALL_NO_NEW_ATTEMPTS',runId:run,baselineRestored:true},
   {intent:'STOP_SIX_CALL_NO_NEW_ATTEMPTS',runId:run,modelCalls:0},
   {intent:'START_NOW',runId:run},
   {intent:'STOP_SIX_CALL_NO_NEW_ATTEMPTS',runId:'../../../'},
   '{bad',
   ' '.repeat(300)
  ])assert.equal((await stop(f,{body})).status,400);
  assert.equal((await stop(f,{url:URL_STOP+'?auth=true'})).status,404);
  assert.equal((await stop(f,{method:'GET'})).status,405);
  assert.equal(row(f).stop_requested,0);
 }finally{f.sqlite.close();}
});
test('stop disabled/DB unavailable fails closed without touching state',async()=>{
 const f=await setup();try{
  assert.equal((await handleSmokeOwnerStop(req(f),
   {...f.env,SMOKE_OWNER_STOP_ENABLED:'false'},{clock:()=>now+100})).status,503);
  assert.equal((await handleSmokeOwnerStop(req(f),
   {...f.env,LOOP_DB:{prepare(){throw Error('down')}}},{clock:()=>now+100})).status,503);
  assert.equal(row(f).stop_requested,0);
 }finally{f.sqlite.close();}
});
test('non-owner runId does not disclose owner information',async()=>{
 const f=await setup();try{
  const r=await stop(f,{body:{intent:'STOP_SIX_CALL_NO_NEW_ATTEMPTS',runId:'unrelated_run_id'}});
  assert.equal(r.status,409);
  assert.equal((await r.json()).status,'STOP_NOT_APPLIED_OR_NOT_OWNED');
  assert.equal(row(f).stop_requested,0);
 }finally{f.sqlite.close();}
});
test('PENDING request stops as BLOCKED without any inference or budget',async()=>{
 const f=await setup({phase:'PENDING'});try{
  const r=await stop(f);assert.equal(r.status,202);
  assert.equal(row(f).phase,'BLOCKED');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM swarm_budget_days').get().n,0);
 }finally{f.sqlite.close();}
});
