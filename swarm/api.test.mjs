import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSwarmApi} from './api.mjs';
import {createDashboardSession,authenticateDashboard,COMMAND_CENTER_ORIGIN} from '../command-center/server.mjs';
import {createDurableLoop} from '../loop-d1.mjs';
const OWNER='123456789012345678',OTHER='223456789012345678';
const BASE=COMMAND_CENTER_ORIGIN+'/command-center/api/swarm/';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../db/migrations/0001_discord_loop_jobs.sql',import.meta.url),'utf8'));
  const db={prepare(s){
    const statement=sql.prepare(s);
    return {bind(...args){return {
      first:async()=>statement.get(...args)||null,
      all:async()=>({results:statement.all(...args)}),
      run:async()=>({meta:{changes:statement.run(...args).changes}})
    }}};
  }};
  return {db,sql};
}
async function sessionFixture(db){
  const env={LOOP_DB:db,DISCORD_ALLOWED_USER_ID:OWNER,DASHBOARD_ENABLED:'true',
    SWARM_API_ENABLED:'true',SWARM_RUNNER_ENABLED:'true',SWARM_EXECUTION_APPROVED:'true',
    SWARM_EXCLUSIVE_MODE:'true',SWARM_DAILY_CALL_CAP:'6',DISCORD_OAUTH_CLIENT_SECRET:'local-test-secret-placeholder',
    DASHBOARD_COOKIE_KEY:'fake_testing_only_cookie_key_not_for_real_auth_1234'};
  const signed=await createDashboardSession(OWNER,env);
  const headers={Cookie:'dc_session='+signed};
  const authenticated=await authenticateDashboard(new Request(BASE+'overview',{headers}),env);
  assert.ok(authenticated?.csrf);
  return {env,headers,csrf:authenticated.csrf};
}
const req=(kind,{headers={},method='GET',body=null}={})=>new Request(BASE+kind,{
  method,headers, ...(body===null?{}:{body:JSON.stringify(body)})
});
const write=(kind,auth,body={})=>req(kind,{method:'POST',body,headers:{
  ...auth.headers,Origin:COMMAND_CENTER_ORIGIN,'Content-Type':'application/json',
  'X-CSRF-Token':auth.csrf}});
test('disabled route fails closed even if owner has valid credentials',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  assert.equal((await handleSwarmApi(req('overview',{headers:auth.headers}),{...auth.env,SWARM_API_ENABLED:'false'})).status,503);
});
test('anonymous users cannot read, create, resume or STOP swarm jobs',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  assert.equal((await handleSwarmApi(req('overview'),auth.env)).status,401);
  assert.equal((await handleSwarmApi(req('stop',{method:'POST',headers:{Origin:COMMAND_CENTER_ORIGIN,'Content-Type':'application/json'},body:{}}),auth.env)).status,401);
});
test('owner-only overview and create with origin+CSRF; duplicate task blocked',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  assert.equal((await handleSwarmApi(req('create',{method:'POST',headers:auth.headers,body:{task:'draft',cycles:1}}),auth.env)).status,403);
  assert.equal((await handleSwarmApi(req('create',{method:'POST',headers:{...auth.headers,Origin:'https://attacker.invalid','Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:{task:'draft',cycles:1}}),auth.env)).status,403);
  const created=await handleSwarmApi(write('create',auth,{task:'draft',cycles:1}),auth.env,{runIdFactory:()=> 'run_one'});
  assert.equal(created.status,201);
  assert.equal((await created.json()).runId,'run_one');
  const second=await handleSwarmApi(write('create',auth,{task:'another',cycles:1}),auth.env,{runIdFactory:()=> 'run_two'});
  assert.equal(second.status,409);
  const overview=await handleSwarmApi(req('overview',{headers:auth.headers}),auth.env);
  assert.equal(overview.status,200);
  assert.equal((await overview.json()).jobs[0].id,'run_one');
});
test('CSRF-protected STOP is owner-scoped and resume cannot revive stopped job',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  await handleSwarmApi(write('create',auth,{task:'draft',cycles:2}),auth.env,{runIdFactory:()=> 'run_stop'});
  assert.equal((await handleSwarmApi(write('stop',auth),auth.env)).status,200);
  const response=await handleSwarmApi(write('resume',auth,{runId:'run_stop'}),auth.env);
  assert.equal((await response.json()).resumed,false);
  const snapshot=await handleSwarmApi(req('overview',{headers:auth.headers}),auth.env);
  assert.equal((await snapshot.json()).jobs[0].status,'stopped');
});
test('invalid user inputs do not create jobs; no information leaked on errors',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  assert.equal((await handleSwarmApi(write('create',auth,{task:'',cycles:1}),auth.env)).status,400);
  assert.equal((await handleSwarmApi(write('create',auth,{task:'x',cycles:7}),auth.env)).status,400);
  assert.equal((await handleSwarmApi(write('resume',auth,{runId:'../../secret'}),auth.env)).status,400);
  assert.equal((await handleSwarmApi(write('create',auth,{task:'x'.repeat(2000),cycles:1}),auth.env)).status,400);
});
test('six-role create refuses a live two-role job and never consumes a model call',async()=>{
 const {db,sql}=fixture(),auth=await sessionFixture(db);
 await createDurableLoop(db,{runId:'legacy_in_progress',requesterId:OWNER,task:'Original protected task'});
 const denied=await handleSwarmApi(write('create',auth,{task:'next staged task',cycles:1}),auth.env);
 assert.equal(denied.status,409);
 assert.equal((await denied.json()).error,'LEGACY_LOOP_ACTIVE');
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM swarm_jobs').get().n,0);
});
test('six-role task creation requires owner configured local call cap',async()=>{
 const {db,sql}=fixture(),auth=await sessionFixture(db);
 const blocked=await handleSwarmApi(write('create',auth,{task:'local safe task',cycles:1}),
 {...auth.env,SWARM_DAILY_CALL_CAP:undefined});
 assert.equal(blocked.status,503);
 assert.equal((await blocked.json()).error,'DAILY_CALL_CAP_REQUIRED');
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM swarm_jobs').get().n,0);
});
test('read-only six-role status works without executing any model call when exclusive flag is off',async()=>{
 const {db}=fixture(),auth=await sessionFixture(db),view={...auth.env,SWARM_EXCLUSIVE_MODE:'false'};
 const r=await handleSwarmApi(req('overview',{headers:auth.headers}),view);
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.runnerEnabled,false);
 const create=await handleSwarmApi(write('create',auth,{task:'not authorized',cycles:1}),view);
 assert.equal(create.status,503);
});
test('wrong-origin read path is not considered the owned Command Center',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  const response=await handleSwarmApi(new Request('https://example.invalid/command-center/api/swarm/overview',{headers:auth.headers}),auth.env);
  assert.equal(response.status,404);
});

test('read-only dashboard remains accessible but mutations fail closed if runner disabled',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  const env={...auth.env,SWARM_RUNNER_ENABLED:'false'};
  const read=await handleSwarmApi(req('overview',{headers:auth.headers}),env);
  assert.equal(read.status,200);
  const info=await read.json();
  assert.equal(info.runnerEnabled,false);
  assert.equal(info.csrfToken,auth.csrf);
  assert.equal((await handleSwarmApi(write('create',auth,{task:'draft',cycles:1}),env)).status,503);
});

test('handoff export requires owner session and exposes only confirmed job state',async()=>{
  const {db}=fixture(),auth=await sessionFixture(db);
  assert.equal((await handleSwarmApi(req('handoff'),auth.env)).status,401);
  const created=await handleSwarmApi(write('create',auth,{task:'handoff test',cycles:1}),auth.env,{runIdFactory:()=> 'handoff_job'});
  assert.equal(created.status,201);
  const response=await handleSwarmApi(req('handoff',{headers:auth.headers}),auth.env);
  assert.equal(response.status,200);
  const out=await response.json();
  assert.equal(out.schema,'discord-swarm.handoff.v1');
  assert.equal(out.runId,'handoff_job');
  assert.equal(out.stepsConfirmed,0);
  assert.match(out.markdown,/handoff test/);
});
