import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import worker, {handleLoopCommand,runOneScheduledLoopStep} from './worker-loop.mjs';
import {getLatestLoop} from './loop-d1.mjs';

const owner='123456789012345678', outsider='223456789012345678';
function db() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./db/migrations/0001_discord_loop_jobs.sql',import.meta.url),'utf8'));
  return {
    prepare(text) {
      const stmt=sql.prepare(text);
      return {first:async()=>stmt.get()??null,bind(...args) {
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
  assert.match((await handleLoopCommand(interaction('loop-status',owner),env)),/元の依頼: Create proposal/);
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
test('D1-backed health rejects missing DB, then confirms uniquely migrated loop worker',async()=>{
  const req=new Request('https://test.invalid/',{method:'GET'});
  assert.equal((await worker.fetch(req,{},{})).status,503);
  const res=await worker.fetch(req,envBase(db()),{});
  assert.equal(res.status,200);
  assert.equal(await res.text(),'Discord GPT Relay loop-v2 task-focus ready.');
});
test('rejects missing D1 and missing AI without starting jobs',async()=>{
  const e=interaction('loop',owner,[{name:'task',value:'Example'}]);
  assert.match(await handleLoopCommand(e,{DISCORD_ALLOWED_USER_ID:owner}),/D1/);
  assert.match(await handleLoopCommand(e,{DISCORD_ALLOWED_USER_ID:owner,LOOP_DB:db()}),/AI/);
});

test('cron cannot start work without an operator allowlist',async()=>{
  const d=db(),env=envBase(d);
  const now=Date.now();
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Example'}]),env,now);
  delete env.DISCORD_ALLOWED_USER_ID;
  await assert.rejects(
    ()=>runOneScheduledLoopStep(env,{now:now+1000,leaseOwner:'blocked'}),
    /Missing loop bindings or operator/
  );
  assert.equal((await getLatestLoop(d,owner)).status,'queued');
});

test('signed /loop interaction acknowledges immediately and queues one job',async()=>{
  const d=db(),env=envBase(d);
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  env.DISCORD_PUBLIC_KEY=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  const event={...interaction('loop',owner,[{name:'task',value:'Write a short outline'}]),type:2,
    application_id:'1558705011339427840',token:'not-a-secret-test-token'};
  const raw=JSON.stringify(event), stamp='1234567890';
  const signature=sign(null,Buffer.from(stamp+raw),privateKey).toString('hex');
  const request=new Request('https://test.invalid/',{
    method:'POST',body:raw,
    headers:{'X-Signature-Ed25519':signature,'X-Signature-Timestamp':stamp}
  });
  const out=[];
  const tasks=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    out.push({url:String(url),method:opts.method,body:JSON.parse(opts.body)});
    return new Response('{}',{status:200});
  };
  try {
    const response=await worker.fetch(request,env,{waitUntil(promise){tasks.push(promise);}});
    assert.equal(response.status,200);
    assert.equal((await response.json()).type,5);
    await Promise.all(tasks);
    assert.equal((await getLatestLoop(d,owner)).status,'queued');
    assert.equal(out.length,1);
    assert.equal(out[0].method,'PATCH');
    assert.match(out[0].body.content,/受付完了/);
    assert.deepEqual(out[0].body.allowed_mentions,{parse:[]});
  }finally {globalThis.fetch=originalFetch;}
});

test('signed /ask interaction still reaches the existing handler',async()=>{
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  const event={...interaction('ask',owner,[{name:'question',value:'こんにちは'}]),type:2,
    application_id:'1558705011339427840',token:'not-a-secret-test-token'};
  const raw=JSON.stringify(event),stamp='0987654321';
  const sig=sign(null,Buffer.from(stamp+raw),privateKey).toString('hex');
  const request=new Request('https://test.invalid/',{method:'POST',body:raw,headers:{
    'X-Signature-Ed25519':sig,'X-Signature-Timestamp':stamp
  }});
  const calls=[], tasks=[], oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    calls.push({url:String(url),body:JSON.parse(opts.body)});
    return new Response('{}',{status:200});
  };
  try{
    const result=await worker.fetch(request,{
      DISCORD_PUBLIC_KEY:key,
      AI:{run:async()=>({response:'既存のaskも正常'})}
    },{waitUntil(promise){tasks.push(promise)}});
    assert.equal((await result.json()).type,5);
    await Promise.all(tasks);
    assert.equal(calls.length,1);
    assert.equal(calls[0].body.content,'既存のaskも正常');
  }finally{globalThis.fetch=oldFetch;}
});

test('off-topic greeting final output is marked failed and never retried',async()=>{
  const d=db(), calls=[];
  const env=envBase(d,async(_model,payload)=>{
    calls.push(payload);
    return {response:calls.length===4
      ? 'タイトル：急いでいるときの安全な行動。周囲に注意してください。'
      : '考えた計画'};
  });
  const now=Date.now();
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'短い挨拶文を改善して'}]),env,now);
  for(let i=0;i<4;i++){
    const r=await runOneScheduledLoopStep(env,{now:now+i*1000,leaseOwner:'quality-'+i});
    assert.equal(r.status,i===3?'failed':'queued');
  }
  const row=await getLatestLoop(d,owner);
  assert.equal(row.calls_used,4);
  assert.equal(row.status,'failed');
  assert.equal(row.last_error_code,'TASK_MISMATCH');
  assert.equal(row.previous_artifact,'考えた計画');
  assert.equal(calls.length,4);
  assert.equal((await runOneScheduledLoopStep(env,{now:now+6000,leaseOwner:'quality-no-retry'})).status,'idle');
  assert.match(await handleLoopCommand(interaction('loop-status',owner),env),/品質検査/);
  assert.ok(calls.every(x=>JSON.parse(x.messages[1].content).original_task==='短い挨拶文を改善して'));
});

test('on-topic greeting completes in four calls and remains viewable to owner',async()=>{
  const d=db(), calls=[];
  const env=envBase(d,async(_model,payload)=>{
    calls.push(payload);
    return {response:calls.length===4
      ? 'こんにちは！今日も素敵な一日をお過ごしください。'
      : '挨拶文をより丁寧にする計画'};
  });
  const now=Date.now();
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'短い挨拶文を改善して'}]),env,now);
  for(let i=0;i<4;i++)await runOneScheduledLoopStep(env,{now:now+i*1000,leaseOwner:'good-'+i});
  const row=await getLatestLoop(d,owner);
  assert.equal(row.status,'completed');
  assert.equal(row.calls_used,4);
  assert.match(row.previous_artifact,/こんにちは/);
  assert.match(await handleLoopCommand(interaction('loop-status',owner),env),/元の依頼: 短い挨拶文を改善して/);
});

test('GPT-OSS candidate health marker differs from production Llama marker',async()=>{
  const req=new Request('https://example.invalid/',{method:'GET'});
  const env={...envBase(db()),LOOP_AI_MODEL:'@cf/openai/gpt-oss-20b'};
  const res=await worker.fetch(req,env,{});
  assert.equal(res.status,200);
  assert.equal(await res.text(),'Discord GPT Relay gpt-oss pilot ready.');
  const wrong=await worker.fetch(req,{...env,LOOP_AI_MODEL:'@cf/unsafe/unknown'},{});
  assert.equal(wrong.status,503);
});

test('GPT-OSS opt-in completes a bounded 4-step loop, keeping existing D1 state',async()=>{
  const database=db(), calls=[];
  const env={...envBase(database,async(model,payload)=>{
    calls.push({model,payload});
    return {response:calls.length===4?'はじめまして、こんにちは！':'挨拶文を改善する提案です。'};
  }),LOOP_AI_MODEL:'@cf/openai/gpt-oss-20b'};
  const now=Date.now();
  const reply=await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'こんにちはを使った短い挨拶文を作って'}]),env,now);
  assert.match(reply,/受付完了/);
  for(let i=0;i<4;i++){
    const stage=await runOneScheduledLoopStep(env,{now:now+i*1000,leaseOwner:'gpt-oss-'+i});
    assert.equal(stage.status,i===3?'completed':'queued');
  }
  assert.equal(calls.length,4);
  assert.ok(calls.every(c=>c.model==='@cf/openai/gpt-oss-20b'));
  assert.deepEqual(calls.map(c=>c.payload.max_tokens),[300,420,300,420]);
  const row=await getLatestLoop(database,owner);
  assert.equal(row.status,'completed');
  assert.equal(row.calls_used,4);
  assert.match(row.previous_artifact,/こんにちは/);
});

test('unsupported configured model never claims or burns a D1 model-call slot',async()=>{
  const database=db(),env={...envBase(database),LOOP_AI_MODEL:'@cf/unknown/not-allowed'};
  const now=Date.now();
  await handleLoopCommand(interaction('loop',owner,[{name:'task',value:'Task'}]),env,now);
  await assert.rejects(()=>runOneScheduledLoopStep(env,{now:now+1000,leaseOwner:'blocked'}),/Unsupported LOOP_AI_MODEL/);
  const row=await getLatestLoop(database,owner);
  assert.equal(row.status,'queued');
  assert.equal(row.calls_used,0);
});
