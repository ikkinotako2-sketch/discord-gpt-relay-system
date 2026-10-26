import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createDashboardSession,COMMAND_CENTER_ORIGIN} from '../command-center/server.mjs';
import {handleSmokeOwnerPrepare,SMOKE_REVIEW_PREPARE_PATH}
 from './smoke-six-call-owner-prepare.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';

const OWNER='123456789012345678';
const NOW=Date.UTC(2026,9,26,6);
const API_URL=COMMAND_CENTER_ORIGIN+SMOKE_REVIEW_PREPARE_PATH;
const originalSql=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
const migrate=readFileSync(new URL('./smoke-six-call-d1-schema.review.sql',import.meta.url),'utf8');
const pendingIndex=readFileSync(new URL('./smoke-six-call-owner-prepare-index.review.sql',import.meta.url),'utf8');
function database(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON;');
 sqlite.exec(originalSql);
 sqlite.exec(migrate);
 sqlite.exec(pendingIndex);
 const db={prepare(query){
  const statement=sqlite.prepare(query);
  return {bind(...args){return {
   first:async()=>statement.get(...args)??null,
   run:async()=>statement.run(...args)
  };}};
 }};
 return {sqlite,db};
}
const validPlan=()=>({
 kind:'SERVER_PINNED_REVIEW_PLAN',target:DISCORD_SMOKE_TARGET,
 baselineVersion:'18c379e8-e759-4b2f-8300-e7a4c8b39b83',
 smokeVersion:'28c379e8-e759-4b2f-8300-e7a4c8b39b83',
 checkedAtMs:NOW,expiresAtMs:NOW+15*60*1000
});
async function setup(){
 const {sqlite,db}=database();
 const env={LOOP_DB:db,DISCORD_ALLOWED_USER_ID:OWNER,
  DASHBOARD_ENABLED:'true',SMOKE_OWNER_PREPARE_ENABLED:'true',
  DISCORD_OAUTH_CLIENT_SECRET:'offline-test-discord-oauth-placeholder-only',
  DASHBOARD_COOKIE_KEY:'offline-test-cookie-signing-secret-placeholder-only',
  SWARM_API_ENABLED:'false',SWARM_RUNNER_ENABLED:'false',
  SWARM_EXECUTION_APPROVED:'false',SWARM_EXCLUSIVE_MODE:'false'};
 const cookie=await createDashboardSession(OWNER,env,NOW);
 let id=0,planCalls=0;
 const deps={clock:()=>NOW,
  idFactory:()=>('unique_test_id_'+(++id)),
  loadReviewedPlan:async()=>{planCalls++;return validPlan();}};
 return {env,sqlite,cookie,deps,planCalls:()=>planCalls};
}
function request(f,{headers={},url=API_URL,method='POST',body={intent:'REVIEW_ONLY_NO_LIVE_ACTIONS'}}={}){
 const h={
  Cookie:'dc_session='+f.cookie,Origin:COMMAND_CENTER_ORIGIN,
  'Content-Type':'application/json','X-CSRF-Token':f.csrf,
  'Sec-Fetch-Site':'same-origin',...headers};
 return new Request(url,{method,headers:h,
  ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
async function authFixture(){
 const f=await setup();
 const body=f.cookie.split('.')[0];
 const payload=JSON.parse(new TextDecoder().decode(
  Uint8Array.from(atob(body.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
 f.csrf=payload.csrf;
 return f;
}
async function handle(f,overrides={}){return handleSmokeOwnerPrepare(request(f,overrides),f.env,f.deps);}
const count=f=>f.sqlite.prepare('SELECT COUNT(*) AS n FROM swarm_smoke_control_runs').get().n;
const rows=f=>f.sqlite.prepare('SELECT * FROM swarm_smoke_control_runs').all();

test('signed Discord OAuth session + exact Origin and CSRF prepares a PENDING-only review',async()=>{
 const f=await authFixture();try{
  const r=await handle(f);
  assert.equal(r.status,202);
  const result=await r.json();
  assert.equal(result.status,'PENDING_REVIEW_ONLY');
  assert.equal(result.authorizesDeployment,false);
  assert.equal(result.authorizesInference,false);
  assert.equal(result.attemptLimit,6);
  assert.equal(r.headers.get('Cache-Control'),'no-store');
  assert.equal(count(f),1);
  const saved=rows(f)[0];
  assert.equal(saved.owner_id,OWNER);
  assert.equal(saved.phase,'PENDING');
  assert.equal(saved.attempts,0);
  assert.equal(saved.completed,0);
  assert.equal(saved.baseline_version,validPlan().baselineVersion);
  assert.equal(saved.smoke_version,validPlan().smokeVersion);
  assert.equal(saved.database_id,DISCORD_SMOKE_TARGET.databaseId);
  assert.ok(saved.task_receipt_id.startsWith('receipt_'));
  assert.equal(f.planCalls(),1);
 }finally{f.sqlite.close();}
});
test('repeated exact same owner request cannot create more than one pending review',async()=>{
 const f=await authFixture();try{
  assert.equal((await handle(f)).status,202);
  const second=await handle(f);
  assert.equal(second.status,409);
  assert.equal((await second.json()).status,'REVIEW_REQUEST_ALREADY_EXISTS');
  assert.equal(count(f),1);
 }finally{f.sqlite.close();}
});
test('two concurrent requests rely on durable unique index, not read-then-insert',async()=>{
 const f=await authFixture();try{
  const out=await Promise.all([handle(f),handle(f)]);
  assert.deepEqual(out.map(x=>x.status).sort(),[202,409]);
  assert.equal(count(f),1);
 }finally{f.sqlite.close();}
});
test('unknown historical swarm job never modified during PENDING preparation',async()=>{
 const f=await authFixture();try{
  f.sqlite.prepare("INSERT INTO swarm_jobs(run_id,owner_id,task,cycles,status,calls_used,created_at,updated_at,expires_at) VALUES(?,?,?,1,'unknown',1,?,?,?)")
    .run('historical_unknown',OWNER,'immutable',NOW-200000,NOW-100000,NOW+100000);
  const before=f.sqlite.prepare('SELECT * FROM swarm_jobs WHERE run_id=?').get('historical_unknown');
  assert.equal((await handle(f)).status,202);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM swarm_jobs WHERE run_id=?').get('historical_unknown'),before);
 }finally{f.sqlite.close();}
});
test('anonymous, signed-cookie tamper and expired OAuth session are rejected',async()=>{
 const f=await authFixture();try{
  let r=await handle(f,{headers:{Cookie:''}});
  assert.equal(r.status,401);
  r=await handle(f,{headers:{Cookie:'dc_session='+f.cookie.slice(0,-1)+'A'}});
  assert.equal(r.status,401);
  r=await handleSmokeOwnerPrepare(request(f),f.env,{...f.deps,clock:()=>NOW+61*60*1000});
  assert.equal(r.status,401);
  assert.equal(count(f),0);
  assert.equal(f.planCalls(),0);
 }finally{f.sqlite.close();}
});
test('Origin/CSRF/content-type/fetch-site rejects before plan or D1 access',async()=>{
 const f=await authFixture();try{
  const alterations=[
   {Origin:'https://attacker.invalid'},
   {'X-CSRF-Token':'not-the-owner-token'},
   {'X-CSRF-Token':''},
   {'Content-Type':'text/plain'},
   {'Sec-Fetch-Site':'cross-site'}
  ];
  for(const headers of alterations)
   assert.equal((await handle(f,{headers})).status,403,JSON.stringify(headers));
  assert.equal(count(f),0);assert.equal(f.planCalls(),0);
 }finally{f.sqlite.close();}
});
test('unknown method, paths or queries do not create a review',async()=>{
 const f=await authFixture();try{
  assert.equal((await handle(f,{method:'GET'})).status,405);
  assert.equal((await handle(f,{url:API_URL+'?override=true'})).status,404);
  assert.equal((await handle(f,{url:COMMAND_CENTER_ORIGIN+'/command-center/api/swarm/create'})).status,404);
  assert.equal(count(f),0);
 }finally{f.sqlite.close();}
});
test('client cannot submit IDs, owner, versions, consent, calls or flags',async()=>{
 const f=await authFixture();try{
  for(const body of [
   {intent:'REVIEW_ONLY_NO_LIVE_ACTIONS',ownerId:OWNER},
   {intent:'REVIEW_ONLY_NO_LIVE_ACTIONS',runId:'forced'},
   {intent:'REVIEW_ONLY_NO_LIVE_ACTIONS',baselineVersion:validPlan().baselineVersion},
   {intent:'REVIEW_ONLY_NO_LIVE_ACTIONS',newExplicitOwnerConsentVerified:true},
   {intent:'REVIEW_ONLY_NO_LIVE_ACTIONS',SWARM_RUNNER_ENABLED:'true'},
   {intent:'REVIEW_ONLY_NO_LIVE_ACTIONS',maxCalls:7},
   {intent:'EXECUTE_SIX_AI_CALLS'},
   {intent:'REVIEW_ONLY_NO_LIVE_ACTIONS',csrf:f.csrf},
   'bad json'
  ])assert.equal((await handle(f,{body})).status,400);
  assert.equal(count(f),0);assert.equal(f.planCalls(),0);
 }finally{f.sqlite.close();}
});
test('disabled default or any four SWARM flags ON blocks before OAuth/plan',async()=>{
 const f=await authFixture();try{
  for(const patch of [{SMOKE_OWNER_PREPARE_ENABLED:'false'},
   {SWARM_API_ENABLED:'true'},{SWARM_RUNNER_ENABLED:'true'},
   {SWARM_EXECUTION_APPROVED:'true'},{SWARM_EXCLUSIVE_MODE:'true'}]){
   const r=await handleSmokeOwnerPrepare(request(f),{...f.env,...patch},f.deps);
   assert.equal(r.status,503);
  }
  assert.equal(count(f),0);assert.equal(f.planCalls(),0);
 }finally{f.sqlite.close();}
});
test('unavailable or stale server plan never creates review; no client-supplied fallback',async()=>{
 const f=await authFixture();try{
  for(const p of [
   null,{...validPlan(),target:{...DISCORD_SMOKE_TARGET,worker:'wrong'}},
   {...validPlan(),checkedAtMs:NOW-6*60*1000},
   {...validPlan(),expiresAtMs:NOW+25*60*1000},
   {...validPlan(),baselineVersion:validPlan().smokeVersion},
   {...validPlan(),kind:'CLIENT_PLAN'}
  ]){
   const r=await handleSmokeOwnerPrepare(request(f),f.env,{
    ...f.deps,loadReviewedPlan:async()=>p
   });
   assert.equal(r.status,503);
  }
  assert.equal(count(f),0);
 }finally{f.sqlite.close();}
});
test('review intent without D1 schema must fail closed without secrets/errors',async()=>{
 const f=await authFixture();try{
  f.sqlite.exec('DROP TABLE swarm_smoke_control_runs');
  const result=await handle(f);
  assert.equal(result.status,503);
  assert.equal((await result.json()).status,'PENDING_WRITE_UNAVAILABLE');
 }finally{f.sqlite.close();}
});
test('empty/big/invalid JSON and fake content-length rejected',async()=>{
 const f=await authFixture();try{
  assert.equal((await handle(f,{body:''})).status,400);
  assert.equal((await handle(f,{body:' '.repeat(270)})).status,400);
  assert.equal((await handle(f,{headers:{'Content-Length':'500'}})).status,400);
  assert.equal(count(f),0);
 }finally{f.sqlite.close();}
});
test('no released start route or model invocation exists in this module',async()=>{
 const f=await authFixture();try{
  const result=await handle(f);
  assert.equal(result.status,202);
  const pending=rows(f)[0];
  assert.equal(pending.phase,'PENDING');
  assert.equal(pending.in_flight_index,null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM swarm_smoke_control_claims').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM swarm_budget_days').get().n,0);
 }finally{f.sqlite.close();}
});
