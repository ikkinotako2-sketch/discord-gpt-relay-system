import test from 'node:test';
import assert from 'node:assert/strict';
import watchdog,{SmokeRestoreOnce} from './smoke-watchdog-worker.mjs';
import {runIndependentWatchdogTick,inspectPostRestore} from './smoke-watchdog-core.mjs';
import {createDiscordD1ReadClient,JOB_QUERIES} from './smoke-watchdog-d1.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
const base='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smoke='3245153e-3281-48e8-a625-0a951d989501';
const beforeId='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const afterId='96ba4fa8-81ce-4d5c-b893-ddb147fedbbe';
const expiry=Date.UTC(2026,9,13,5,20);
const extra=['DISCORD_PUBLIC_KEY','DISCORD_ALLOWED_USER_ID','DISCORD_OAUTH_CLIENT_SECRET','DASHBOARD_COOKIE_KEY'];
const bind=(kind)=>[
 {name:'LOOP_DB',type:'d1',database_id:DISCORD_SMOKE_TARGET.databaseId},
 ...extra.map(name=>({name,type:'secret_text'})),
 ...FLAGS.map(name=>({name,type:'plain_text',text:kind==='smoke'?'true':'false'})),
 {name:'SWARM_DAILY_CALL_CAP',type:'plain_text',text:'6'},
 {name:'SWARM_SMOKE_EXPIRES_AT',type:'plain_text',text:String(expiry)}
];
const armed=()=>({
 WATCHDOG_ARMED:'EXPLICIT_DISCORD_SMOKE_RESTORE_ONCE',
 WATCHDOG_APPROVAL:'RESTORE-DISCORD-SMOKE-BASELINE-ONCE',
 WATCHDOG_ACCOUNT_ID:DISCORD_SMOKE_TARGET.accountId,
 WATCHDOG_WORKER:DISCORD_SMOKE_TARGET.worker,
 WATCHDOG_D1_ID:DISCORD_SMOKE_TARGET.databaseId,
 WATCHDOG_BASELINE_VERSION:base,WATCHDOG_SMOKE_VERSION:smoke,
 WATCHDOG_EXPECTED_DEPLOYMENT_ID:beforeId,WATCHDOG_EXPIRES_AT:String(expiry),
 WATCHDOG_ONCE:{idFromName:name=>name,get:id=>({fetch:async()=>Response.json({claimed:true})})},
 WATCHDOG_RESTORE_TOKEN:'test-restorer-token',
 WATCHDOG_D1_READ_TOKEN:'test-d1-read-token'
});
function fake(options={}){
 let live=options.live||smoke,id=beforeId,posts=0,d1Reads=0,seen=[];
 const api=(result,success=true,status=200)=>({ok:status>=200&&status<300,
  status,json:async()=>({success,result}),text:async()=> 'Discord GPT Relay gpt-oss command-center ready.'});
 const mock=async(url,opts={})=>{
  const method=opts.method||'GET';seen.push({url,method,body:opts.body||'',headers:opts.headers||{}});
  if(url.includes('workers.dev'))return {status:method==='POST'?401:200,
   text:async()=> 'Discord GPT Relay gpt-oss command-center ready.'};
  if(url.includes('/d1/database/')){
   assert.equal(method,'POST');
   const payload=JSON.parse(opts.body);
   assert.equal(Object.values(JOB_QUERIES).includes(payload.sql),true);
   assert.match(payload.sql,/^SELECT /);
   assert.doesNotMatch(payload.sql,/\b(?:UPDATE|DELETE|INSERT|DROP|ALTER)\b/i);
   d1Reads++;
   if(options.d1Error && d1Reads>=options.d1Error)return api(null,false,503);
   const isSwarm=payload.sql.includes('FROM swarm_jobs');
   const result={active_jobs:isSwarm?(options.swarmActive||0):(options.legacyActive||0),
    ...(isSwarm?{unknown_jobs:options.unknownJobs||0,pending_stop:options.pendingStop||0}:{})};
   if(options.d1Malformed && isSwarm)result.active_jobs='0';
   return api([{success:true,results:[result]}]);
  }
  if(url.endsWith('/deployments')&&method==='GET')
   return api({deployments:[{id,created_on:'2026-10-13T05:00:00Z',
    versions:options.split?[{version_id:smoke,percentage:50},{version_id:base,percentage:50}]
      :[{version_id:live,percentage:100}]}]});
  if(url.endsWith('/versions/'+base))return api({id:base,resources:{bindings:options.baselineBindings||bind('baseline')}});
  if(url.endsWith('/versions/'+smoke))return api({id:smoke,resources:{bindings:bind('smoke')}});
  if(url.endsWith('/deployments')&&method==='POST'){
   posts++;
   if(options.uncertainPost)throw Error('network disconnected');
   id=afterId;live=options.wrongVersion?smoke:base;
   return api({id:afterId});
  }
  throw Error('Unexpected URL '+url);
 };
 return {fetchImpl:mock,get posts(){return posts},get d1Reads(){return d1Reads},get seen(){return seen}};
}
function once(){
 let claimed=false;
 return async()=>{if(claimed)return false;claimed=true;return true;};
}
test('prearmed watchdog may capture ONLY the pinned smoke deployment ID after deadline',async()=>{
 const m=fake(),env=armed();env.WATCHDOG_EXPECTED_DEPLOYMENT_ID='PREARM_TO_CAPTURE_SMOKE_DEPLOYMENT';
 const result=await runIndependentWatchdogTick(env,{nowMs:expiry+1000,
  fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(result.status,'OFF_VERIFIED',JSON.stringify(result));
 assert.equal(m.posts,1);
});
test('prearm blocks unknown live version without changing any production deployment',async()=>{
 const m=fake({live:'d6f56f53-faa5-49a7-865c-5b6d3bc83942'});
 const env=armed();env.WATCHDOG_EXPECTED_DEPLOYMENT_ID='PREARM_TO_CAPTURE_SMOKE_DEPLOYMENT';
 const result=await runIndependentWatchdogTick(env,{nowMs:expiry+1,
  fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(result.reason,'PREARM_UNKNOWN_LIVE_VERSION_NO_RESTORE');
 assert.equal(m.posts,0);
});
test('prearm while baseline remains live is already OFF without any restore POST',async()=>{
 const m=fake({live:base});const env=armed();
 env.WATCHDOG_EXPECTED_DEPLOYMENT_ID='PREARM_TO_CAPTURE_SMOKE_DEPLOYMENT';
 const result=await runIndependentWatchdogTick(env,{nowMs:expiry+1,
  fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(result.status,'OFF_VERIFIED',JSON.stringify(result));
 assert.equal(m.posts,0);
});
test('unarmed watchdog and mismatched target never call network or claim',async()=>{
 const m=fake(), env=armed();env.WATCHDOG_ARMED='false';
 const a=await runIndependentWatchdogTick(env,{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:()=>{throw Error('called')}});
 assert.equal(a.reason,'NOT_ARMED');
 const w=armed();w.WATCHDOG_D1_ID='other';
 const b=await runIndependentWatchdogTick(w,{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:()=>{throw Error('called')}});
 assert.equal(b.reason,'TARGET_MISMATCH');
 assert.equal(m.seen.length,0);
});
test('before expiry returns WAIT without latch, D1 read, Cloudflare API or inference',async()=>{
 const m=fake();const x=await runIndependentWatchdogTick(armed(),{nowMs:expiry-1,fetchImpl:m.fetchImpl});
 assert.equal(x.status,'WAIT');assert.equal(m.seen.length,0);
});
test('expired watchdog restores baseline, checks all OFF flags, D1 counts and health',async()=>{
 const m=fake();const claim=once();const cfg=armed();
 const a=await runIndependentWatchdogTick(cfg,{nowMs:expiry+1000,fetchImpl:m.fetchImpl,claimOnce:claim});
 assert.equal(a.status,'OFF_VERIFIED',JSON.stringify(a));assert.equal(m.posts,1);
 assert.equal(a.flags,'ALL_ABSENT_OR_FALSE');
 assert.equal(m.d1Reads,4);
 assert.ok(m.seen.every(x=>x.url.includes('steep-glitter-b5cddiscord-ai-relay-lab')||x.url.includes(DISCORD_SMOKE_TARGET.databaseId)));
 const b=await runIndependentWatchdogTick(cfg,{nowMs:expiry+2000,fetchImpl:m.fetchImpl,claimOnce:claim});
 assert.equal(b.reason,'ALREADY_ATTEMPTED_OR_LATCH_UNAVAILABLE');
 assert.equal(m.posts,1);
});
test('watchdog refuses ancient or badly delayed restore without D1, claim or Cloudflare traffic',async()=>{
 for(const delay of [20*60*1000+1,24*60*60*1000]){
  const m=fake();
  let claimed=0;
  const r=await runIndependentWatchdogTick(armed(),{
   nowMs:expiry+delay,fetchImpl:m.fetchImpl,claimOnce:async()=>{claimed++;return true;}
  });
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'WATCHDOG_RESTORE_WINDOW_STALE_MANUAL_RECOVERY');
  assert.equal(claimed,0);assert.equal(m.seen.length,0);
  assert.equal(m.posts,0);assert.equal(m.d1Reads,0);
 }
});
test('uncertain deployment POST is single attempt and cannot auto retry',async()=>{
 const m=fake({uncertainPost:true}),claim=once();
 const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1000,fetchImpl:m.fetchImpl,claimOnce:claim});
 assert.equal(a.status,'BLOCKED');assert.equal(m.posts,1);
 const b=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1200,fetchImpl:m.fetchImpl,claimOnce:claim});
 assert.equal(b.status,'BLOCKED');assert.equal(m.posts,1);
});
test('D1 unknown job never becomes confirmed completion after safe restore',async()=>{
 const m=fake({unknownJobs:1});
 const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(a.status,'BLOCKED');assert.match(a.reason,/UNKNOWN|UNVERIFIED/);assert.equal(m.posts,1);
});
test('D1 claimed/queued/quota_wait active means restore to OFF but no false completion',async()=>{
 const m=fake({swarmActive:1});
 const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(a.reason,'POST_RESTORE_ACTIVE_JOBS_UNRESOLVED');
 assert.equal(m.posts,1);
});
test('D1 read outage after expiry does not prevent OFF attempt, never claims PASS',async()=>{
 const m=fake({d1Error:1});
 const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(a.status,'BLOCKED');
 assert.equal(m.posts,1);
});
test('unexpected worker version or concurrent split stops without restore',async()=>{
 for(const o of [{split:true},{live:'d6f56f53-faa5-49a7-865c-5b6d3bc83942'}]){
  const m=fake(o);
  const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:once()});
  assert.equal(a.status,'BLOCKED');assert.equal(m.posts,0);
 }
});
test('after-restore wrong live version does not count as success',async()=>{
 const m=fake({wrongVersion:true});
 const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(a.status,'BLOCKED');assert.equal(m.posts,1);
});
test('remote baseline flags present true rejects restore before any POST',async()=>{
 const bad=bind('baseline').map(b=>b.name===FLAGS[2]?{...b,text:'true'}:b);
 const m=fake({baselineBindings:bad});
 const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(a.status,'BLOCKED');assert.equal(m.posts,0);
});
test('D1 malformed response is not zero, blocks a verified PASS',async()=>{
 const m=fake({d1Malformed:true});
 const a=await runIndependentWatchdogTick(armed(),{nowMs:expiry+1,fetchImpl:m.fetchImpl,claimOnce:once()});
 assert.equal(a.status,'BLOCKED');assert.equal(m.posts,1);
});
test('D1 read client never sends SQL mutations or other database id',async()=>{
 const m=fake(),r=createDiscordD1ReadClient({token:'fake-d1-token',fetchImpl:m.fetchImpl});
 const snapshot=await r.snapshot();assert.equal(snapshot.clean,true);
 assert.equal(m.d1Reads,2);
 assert.equal(m.seen.every(x=>x.url.includes(DISCORD_SMOKE_TARGET.databaseId)),true);
});
test('durable object rejects restore claim until independent alarm was confirmed',async()=>{
 const map=new Map();
 const storage={transaction:async cb=>cb({
  get:async k=>map.get(k),put:async(k,v)=>{map.set(k,v);}
 })};
 const obj=new SmokeRestoreOnce({storage},armed());
 const req=()=>new Request('https://watchdog.internal/claim',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({smokeVersion:smoke,expiryMs:expiry})});
 // Missing alarm, armed but no setAlarm receipt, or wrong receipt: NONE can restore.
 const none=await obj.fetch(req());assert.equal((await none.json()).claimed,false);
 map.set('armed',{smokeVersion:smoke,expiryMs:expiry});
 const incomplete=await obj.fetch(req());assert.equal((await incomplete.json()).claimed,false);
 map.set('alarm_confirmed',{smokeVersion:smoke,expiryMs:expiry+1});
 const mismatched=await obj.fetch(req());assert.equal((await mismatched.json()).claimed,false);
 assert.equal(map.has('attempted'),false);
 map.set('alarm_confirmed',{smokeVersion:smoke,expiryMs:expiry});
 const a=await obj.fetch(req());assert.equal((await a.json()).claimed,true);
 const b=await obj.fetch(req());assert.equal((await b.json()).claimed,false);
 assert.equal(map.get('attempted').smokeVersion,smoke);
});
test('post-restore verification rejects every shadow LOOP_DB name before D1 read',async()=>{
 for(const extra of [
  {name:'LOOP_DB',type:'plain_text',text:'shadow'},
  {name:'LOOP_DB',type:'secret_text'},
  {name:'LOOP_DB',type:'d1',database_id:DISCORD_SMOKE_TARGET.databaseId}
 ]){
  let snapshots=0;
  const client={deployment:async()=>({versionId:base}),bindings:async()=>[...bind('baseline'),extra]};
  const reader={snapshot:async()=>{snapshots++;return {clean:true,terminal:true};}};
  const result=await inspectPostRestore(client,reader,base);
  assert.equal(result.status,'BLOCKED');assert.equal(result.reason,'POST_RESTORE_D1_MISMATCH');
  assert.equal(snapshots,0);
 }
});
test('public watchdog HTTP endpoint never offers a manual POST trigger',async()=>{
 const r=await watchdog.fetch(new Request('https://watchdog.example/claim',{method:'POST'}));
 assert.equal(r.status,404);
});
