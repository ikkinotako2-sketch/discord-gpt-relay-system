import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {handleLoopCommand,runOneScheduledLoopStep} from './worker-loop.mjs';
import {getLatestLoop} from './loop-d1.mjs';

const owner='123456789012345678', outsider='223456789012345678';
function db() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./db/migrations/0001_discord_loop_jobs.sql',import.meta.url),'utf8'));
  return {
    prepare(text) {
      const stmt=sql.prepare(text);
      return {bind(...args) {
        return {
          first:async()=>stmt.get(...args)??null,
          run:async()=>({meta:{changes:stmt.run(...args).changes}})
        };
      }};
    }
  };
}
function interaction(name,id=owner,options=[],interactionId='1558705011339427999') {
  return {id:interactionId,data:{name,options},member:{user:{id}}};
}
const envBase=(database,run)=>
  ({LOOP_DB:database,DISCORD_ALLOWED_USER_ID:owner,
    AI:{run:run ?? (async()=>({response:'安全な提案です'}))}});

test('only the configured Discord operator can create jobs',async()=>{
  const d=db(),env=envBase(d);
  const denied=await handleLoopCommand(interaction('loop',outsider,[{name:'task',value:'Task'}]),env,1000);
  assert.match(denied,/管理者専用/);
  assert.equal(await getLatestLoop(d,owner),null);
  const allowed=await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Task'}]),env,1000);
  assert.match(allowed,/受付完了/);
  assert.equal((await getLatestLoop(d,owner)).status,'queued');
  const duplicate=await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Task'}]),env,1001);
  assert.match(duplicate,/受付済み/);
});
test('unauthorized requests cannot see or stop operator jobs',async()=>{
  const d=db(),env=envBase(d);
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Private task'}]),env,1000);
  assert.match(await handleLoopCommand(interaction('loop-status',outsider),env),/管理者専用/);
  assert.match(await handleLoopCommand(interaction('loop-stop',outsider),env),/管理者専用/);
  assert.equal((await getLatestLoop(d,owner)).status,'queued');
});
test('one call per scheduled tick: four calls and a final persisted answer',async()=>{
  const d=db(),events=[];
  const env=envBase(d,async(_model,payload)=>{
    events.push(payload);
    return {response:'result-'+events.length};
  });
  const now=Date.now();
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Create proposal'}]),env,now);
  for(let i=0;i<4;i++) {
    const r=await runOneScheduledLoopStep(env,{now:now+i*1000,leaseOwner:'lease-'+i});
    assert.equal(r.status,i===3?'completed':'queued');
  }
  assert.equal(events.length,4);
  assert.equal((await getLatestLoop(d,owner)).calls_used,4);
  assert.match((await handleLoopCommand(interaction('loop-status',owner),env)),/最終案/);
  assert.equal((await runOneScheduledLoopStep(env,{now:now+4000,leaseOwner:'lease-5'})).status,'idle');
});
test('loop-stop immediately stops queued task with zero model calls',async()=>{
  const d=db();let calls=0;
  const env=envBase(d,async()=>{calls++;return {response:'never'};});
  const now=Date.now();
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Example'}]),env,now);
  assert.match(await handleLoopCommand(interaction('loop-stop',owner),env,now+1),/停止しました/);
  assert.equal((await runOneScheduledLoopStep(env,{now:now+1000,leaseOwner:'stop-1'})).status,'idle');
  assert.equal(calls,0);
});
test('error in one AI call ends job without retry',async()=>{
  const d=db();let calls=0;
  const env=envBase(d,async()=>{calls++;throw Error('Provider outage');});
  const now=Date.now();
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Example'}]),env,now);
  assert.equal((await runOneScheduledLoopStep(env,{now:now+1000,leaseOwner:'fail-1'})).status,'failed');
  assert.equal((await getLatestLoop(d,owner)).status,'failed');
  assert.equal((await runOneScheduledLoopStep(env,{now:now+2000,leaseOwner:'fail-2'})).status,'idle');
  assert.equal(calls,1);
});
test('missing operator allowlist disables command even with correct Discord ID',async()=>{
  const d=db(),env=envBase(d);delete env.DISCORD_ALLOWED_USER_ID;
  assert.match(await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Example'}]),env),/管理者専用/);
});
test('unsigned Discord requests get 401 and cannot reach D1',async()=>{
  const d=db(),env={...envBase(d),DISCORD_PUBLIC_KEY:'00'.repeat(32)};
  const req=new Request('https://test.invalid/',{method:'POST',
    body:JSON.stringify({type:2,data:{name:'loop'},member:{user:{id:owner}}})});
  const result=await worker.fetch(req,env,{waitUntil(){}});
  assert.equal(result.status,401);
  assert.equal(await getLatestLoop(d,owner),null);
});
test('public GET health remains compatible with legacy /ask and /relay Worker',async()=>{
  const res=await worker.fetch(new Request('https://test.invalid/',{method:'GET'}),{},{});
  assert.equal(res.status,200);
  assert.equal(await res.text(),'Discord GPT Relay ready (latency-v1).');
});
test('rejects missing D1 and missing AI without starting jobs',async()=>{
  const e=interaction('loop',owner,[{name:'task',value:'Example'}]);
  assert.match(await handleLoopCommand(e,{DISCORD_ALLOWED_USER_ID:owner}),/D1/);
  assert.match(await handleLoopCommand(e,{DISCORD_ALLOWED_USER_ID:owner,LOOP_DB:db()}),/AI/);
});
