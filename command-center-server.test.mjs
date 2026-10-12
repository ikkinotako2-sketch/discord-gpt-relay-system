import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {DASHBOARD_HTML} from './command-center/page.mjs';
import {handleDashboardRequest,createDashboardSession,authenticateDashboard,COMMAND_CENTER_ORIGIN} from './command-center/server.mjs';
const OWNER='123456789012345678',OUTSIDER='223456789012345678';
function setup(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./db/migrations/0001_discord_loop_jobs.sql',import.meta.url),'utf8'));
  const db={prepare(sql){
    const q=sqlite.prepare(sql);
    return {
      first:async()=>q.get()??null,
      bind(...args){return {
        all:async()=>({results:q.all(...args)}),
        first:async()=>q.get(...args)??null,
        run:async()=>({meta:{changes:q.run(...args).changes}}),
      }},
    };
  }};
  return {
    sqlite,
    env:{DASHBOARD_ENABLED:'true',
      DISCORD_OAUTH_CLIENT_SECRET:'client-secret-test-value-unique-123456',
      DASHBOARD_COOKIE_KEY:'private-session-key-example-long-enough-1234567890',
      DISCORD_ALLOWED_USER_ID:OWNER,LOOP_DB:db},
  };
}
const req=(path,options={})=>new Request(COMMAND_CENTER_ORIGIN+path,options);
const sessionRequest=(path,env,session,options={})=>req(path,{
  ...options,headers:{Cookie:'dc_session='+session,...options.headers}
});
test('static dashboard module exactly matches editable HTML source',()=>{
  assert.equal(DASHBOARD_HTML,readFileSync(new URL('./command-center/index.html',import.meta.url),'utf8'));
  assert.match(DASHBOARD_HTML,/AI Relay Command Center/);
  assert.match(DASHBOARD_HTML,/DEMO — 未接続/);
});
test('dashboard is disabled without explicit OAuth and session secrets',async()=>{
  const env={...setup().env};
  delete env.DASHBOARD_COOKIE_KEY;
  const r=await handleDashboardRequest(req('/command-center/'),env);
  assert.equal(r.status,503);
  assert.doesNotMatch(await r.text(),/プレビュー用/);
});
test('unauthenticated dashboard redirects and history API reveals nothing',async()=>{
  const {env}=setup();
  const r=await handleDashboardRequest(req('/command-center/'),env);
  assert.equal(r.status,302);
  assert.equal(r.headers.get('location'),'/command-center/login');
  const api=await handleDashboardRequest(req('/command-center/api/overview'),env);
  assert.equal(api.status,401);
  assert.equal((await api.json()).error,'AUTH_REQUIRED');
});
test('OAuth login uses only identify scope and an HttpOnly state cookie',async()=>{
  const {env}=setup();
  const r=await handleDashboardRequest(req('/command-center/login'),env);
  assert.equal(r.status,302);
  const url=new URL(r.headers.get('location'));
  assert.equal(url.hostname,'discord.com');
  assert.equal(url.searchParams.get('scope'),'identify');
  assert.equal(url.searchParams.get('client_id'),'1558705011339427840');
  assert.equal(url.searchParams.get('redirect_uri'),COMMAND_CENTER_ORIGIN+'/command-center/callback');
  assert.match(r.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);
  assert.ok(url.searchParams.get('state'));
});
test('OAuth callback rejects forged state without contacting Discord',async()=>{
  const {env}=setup();
  const r=await handleDashboardRequest(req('/command-center/callback?state=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa&code=dummy',{headers:{
    Cookie:'dc_oauth_state=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  }}),env);
  assert.equal(r.status,400);
});
test('valid owner OAuth yields signed session without retaining access token',async()=>{
  const {env}=setup();
  const start=await handleDashboardRequest(req('/command-center/login'),env);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const old=globalThis.fetch;
  const hits=[];
  globalThis.fetch=async(url,opts)=>{
    hits.push(String(url));
    if(String(url).includes('/oauth2/token')){
      const body=opts.body;
      assert.equal(body.get('grant_type'),'authorization_code');
      assert.equal(body.get('client_secret'),env.DISCORD_OAUTH_CLIENT_SECRET);
      return Response.json({access_token:'oauth-private-test-token',token_type:'Bearer'});
    }
    if(String(url).includes('/users/@me')){
      assert.equal(opts.headers.Authorization,'Bearer oauth-private-test-token');
      return Response.json({id:OWNER});
    }
    throw Error('Unexpected network request');
  };
  try{
    const r=await handleDashboardRequest(req('/command-center/callback?state='+state+'&code=abc',{
      headers:{Cookie:'dc_oauth_state='+state}
    }),env);
    assert.equal(r.status,302);
    assert.equal(r.headers.get('location'),'/command-center/');
    const cookies=r.headers.getSetCookie();
    const sessionCookie=cookies.find(x=>x.startsWith('dc_session='));
    assert.ok(sessionCookie);
    assert.match(sessionCookie,/HttpOnly/);
    assert.doesNotMatch(sessionCookie,/oauth-private-test-token/);
    assert.deepEqual(hits.length,2);
    const cookieValue=sessionCookie.split(';')[0].slice('dc_session='.length);
    const home=await handleDashboardRequest(sessionRequest('/command-center/',env,cookieValue),env);
    assert.equal(home.status,200);
    assert.match(home.headers.get('content-security-policy'),/script-src 'sha256-/);
    assert.doesNotMatch(home.headers.get('content-security-policy'),/script-src 'unsafe-inline'/);
  }finally{globalThis.fetch=old;}
});
test('different Discord user is denied even with valid OAuth exchange',async()=>{
  const {env}=setup();const old=globalThis.fetch;
  globalThis.fetch=async url=>String(url).includes('token')?
    Response.json({access_token:'different-user',token_type:'Bearer'}):Response.json({id:OUTSIDER});
  const state='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  try{
    const r=await handleDashboardRequest(req('/command-center/callback?state='+state+'&code=abc',{
      headers:{Cookie:'dc_oauth_state='+state}
    }),env);
    assert.equal(r.status,403);
    assert.doesNotMatch(r.headers.get('set-cookie')||'',/dc_session/);
  }finally{globalThis.fetch=old;}
});
test('invalid session or expired cookie is refused',async()=>{
  const {env}=setup();
  const session=await createDashboardSession(OWNER,env,100000);
  assert.ok(await authenticateDashboard(req('/command-center/api/overview',{
    headers:{Cookie:'dc_session='+session}
  }),env,101000));
  const tampered=session.replace(/^./,session.startsWith('a')?'b':'a');
  assert.equal(await authenticateDashboard(req('/command-center/api/overview',{
    headers:{Cookie:'dc_session='+tampered}
  }),env,101000),null);
  assert.equal(await authenticateDashboard(req('/command-center/api/overview',{
    headers:{Cookie:'dc_session='+session}
  }),env,100000+3600001),null);
  await assert.rejects(()=>createDashboardSession(OUTSIDER,env),/Unauthorized/);
});
test('owner can read D1 and issue CSRF-protected start and stop',async()=>{
  const {env,sqlite}=setup();
  const session=await createDashboardSession(OWNER,env);
  const before=await handleDashboardRequest(sessionRequest('/command-center/api/overview',env,session),env);
  assert.equal(before.status,200);
  const state=await before.json();
  assert.equal(state.jobs.length,0);
  assert.equal(state.modelName,'Llama 3.1 8B');
  assert.deepEqual(state.jobs.map(j=>j.history),[]);
  const postOptions=(body,headers={})=>({
    method:'POST',body:JSON.stringify(body),
    headers:{Origin:COMMAND_CENTER_ORIGIN,'Content-Type':'application/json',
      'X-CSRF-Token':state.csrfToken,...headers}
  });
  const denied=await handleDashboardRequest(sessionRequest('/command-center/api/start',env,session,
    postOptions({task:'短い挨拶文'}, {'X-CSRF-Token':'wrong'})),env);
  assert.equal(denied.status,403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM relay_loop_jobs').get().n,0);
  const allowed=await handleDashboardRequest(sessionRequest('/command-center/api/start',env,session,
    postOptions({task:'短い挨拶文'})),env);
  assert.equal(allowed.status,202);
  const created=await allowed.json();assert.equal(created.accepted,true);
  const duplicate=await handleDashboardRequest(sessionRequest('/command-center/api/start',env,session,
    postOptions({task:'second job'})),env);
  assert.equal(duplicate.status,409);
  const stopped=await handleDashboardRequest(sessionRequest('/command-center/api/stop',env,session,
    postOptions({})),env);
  assert.equal(stopped.status,200);
  assert.equal((await stopped.json()).status,'stopped');
  assert.equal(sqlite.prepare('SELECT status FROM relay_loop_jobs').get().status,'stopped');
});
test('cross-origin POST and missing CSRF cannot launch a job',async()=>{
  const {env,sqlite}=setup();
  const session=await createDashboardSession(OWNER,env);
  const bad=await handleDashboardRequest(sessionRequest('/command-center/api/start',env,session,{
    method:'POST',body:JSON.stringify({task:'hello'}),
    headers:{'Content-Type':'application/json',Origin:'https://malicious.invalid',
      'X-CSRF-Token':'fake'}
  }),env);
  assert.equal(bad.status,403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM relay_loop_jobs').get().n,0);
});
test('dashboard rejects unexpected origin and never becomes public status endpoint',async()=>{
  const {env}=setup();
  const r=await handleDashboardRequest(new Request('https://evil.invalid/command-center/api/overview'),env);
  assert.equal(r.status,404);
});

test('dashboard identifies current GPT-OSS model without asserting model on old historical jobs',async()=>{
  const {env}=setup();
  env.LOOP_AI_MODEL='@cf/openai/gpt-oss-20b';
  const session=await createDashboardSession(OWNER,env);
  const r=await handleDashboardRequest(sessionRequest('/command-center/api/overview',env,session),env);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.modelName,'GPT-OSS 20B');
  assert.equal(data.modelScope,'current_settings_only');
});

test('owner-only overview includes handoff history without leaking it to unauthenticated callers',async()=>{
  const {env,sqlite}=setup();
  const current=Date.now();
  sqlite.prepare(`INSERT INTO relay_loop_jobs
    (run_id,requester_discord_id,task,status,next_role,round_number,max_rounds,
     calls_used,revision,history_json,stop_requested,active_slot,created_at,updated_at,expires_at,previous_artifact)
     VALUES (? ,?,?,'completed',NULL,2,2,4,0,?,0,NULL,?,?,?,?)`)
    .run('dash-history-test',OWNER,'元の依頼のテスト',
      JSON.stringify([{round:1,role:'planner',output:'Aが作成した計画'},
        {round:1,role:'builder',output:'Bが受け取った計画の結果'}]),
      current,current,current+60000,'完成文');
  const denied=await handleDashboardRequest(req('/command-center/api/overview'),env);
  assert.equal(denied.status,401);
  const session=await createDashboardSession(OWNER,env);
  const allowed=await handleDashboardRequest(sessionRequest('/command-center/api/overview',env,session),env);
  assert.equal(allowed.status,200);
  const obj=await allowed.json();
  assert.equal(obj.jobs.length,1);
  assert.deepEqual(obj.jobs[0].history.map(s=>s.text),['Aが作成した計画','Bが受け取った計画の結果']);
  assert.equal(obj.jobs[0].finalResult,'完成文');
});
