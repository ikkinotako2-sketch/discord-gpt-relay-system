import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscordCloudflareClient,restoreDiscordSmoke,RestoreBlocked} from './smoke-restore-executor.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';

const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smoke='3245153e-3281-48e8-a625-0a951d989501';
const first='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const second='96ba4fa8-81ce-4d5c-b893-ddb147fedbbe';
const expiry=Date.UTC(2026,9,13,5,20,0);
const secrets=['DISCORD_PUBLIC_KEY','DISCORD_ALLOWED_USER_ID','DISCORD_OAUTH_CLIENT_SECRET','DASHBOARD_COOKIE_KEY'];
function makeBindings(kind='smoke'){
 return [
  {name:'LOOP_DB',type:'d1',database_id:DISCORD_SMOKE_TARGET.databaseId},
  ...secrets.map(name=>({name,type:'secret_text'})),
  ...FLAGS.map(name=>({name,type:'plain_text',text:kind==='smoke'?'true':'false'})),
  {name:'SWARM_DAILY_CALL_CAP',type:'plain_text',text:'6'},
  {name:'SWARM_SMOKE_EXPIRES_AT',type:'plain_text',text:String(expiry)}
 ];
}
function mockCloudflare({active=smoke,oldBindings=makeBindings('baseline'),
 smokeBindings=makeBindings('smoke'),split=false,concurrent=false,
 failPost=false,postWrong=false,wrongReceipt=false,healthStatus=401,
 extraLaterDeployment=false}={}){
 let live=active,posted=0,gets=0;
 const calls=[];
 let id=first;
 const reply=(result,success=true,status=200)=>({
  ok:status>=200&&status<300,status,
  json:async()=>({success,result,errors:success?[]:[{code:42}]}),
  text:async()=> 'Discord GPT Relay gpt-oss command-center ready.'
 });
 async function impl(url,options={}){
  const method=options.method||'GET';
  calls.push({url,method,headers:options.headers||{}});
  if(url.includes('workers.dev')){
   return {status:method==='POST'?healthStatus:200,
    text:async()=> 'Discord GPT Relay gpt-oss command-center ready.'};
  }
  if(url.endsWith('/deployments')&&method==='GET'){
   gets++;
   if(concurrent&&gets===2){id=second;live=smoke;}
   return reply({deployments:[{id,created_on:'2026-10-13T05:00:00Z',
    versions:split?[{version_id:smoke,percentage:50},{version_id:baseline,percentage:50}]
    :[{version_id:live,percentage:100}]},
    ...(extraLaterDeployment?[{id:'cfe1d13b-c2ee-4298-9d6f-25478a6e03d8',
      created_on:'2026-10-13T06:00:00Z',versions:[{version_id:baseline,percentage:100}]}]:[])]});
  }
  if(url.endsWith('/versions/'+baseline)){
   return reply({id:baseline,resources:{bindings:oldBindings}});
  }
  if(url.endsWith('/versions/'+smoke)){
   return reply({id:smoke,resources:{bindings:smokeBindings}});
  }
  if(url.endsWith('/deployments')&&method==='POST'){
   posted++;
   if(failPost)throw Error('connection lost after request');
   assert.equal(options.body.includes('"percentage":100'),true);
   assert.equal(options.body.includes(baseline),true);
   id=second;
   live=postWrong?smoke:baseline;
   return reply({id:wrongReceipt?first:second});
  }
  throw Error('Unexpected mock URL '+method+' '+url);
 }
 return {impl,calls,get posted(){return posted;}};
}
const input=(mock,overrides={})=>({
 client:createDiscordCloudflareClient({token:'fake-test-token',fetchImpl:mock.impl}),
 baselineVersion:baseline,smokeVersion:smoke,expectedDeploymentId:first,
 expiryMs:expiry,nowMs:expiry+1000,execute:true,
 approval:'RESTORE-DISCORD-SMOKE-BASELINE-ONCE',...overrides
});
const rejects=async (promise,match)=>assert.rejects(promise,e=>e instanceof RestoreBlocked&&e.reason.includes(match));

test('never makes a network call unless explicitly one-shot approved',async()=>{
 const m=mockCloudflare();
 await rejects(restoreDiscordSmoke(input(m,{execute:false})),'OWNER_EXECUTION_APPROVAL_REQUIRED');
 await rejects(restoreDiscordSmoke(input(m,{approval:'WRONG'})),'OWNER_EXECUTION_APPROVAL_REQUIRED');
 assert.equal(m.calls.length,0);
});
test('successful single restore calls ONLY Discord Worker, verifies version and unsigned signature',async()=>{
 const m=mockCloudflare();
 const r=await restoreDiscordSmoke(input(m));
 assert.equal(r.status,'RESTORED_VERSION_VERIFIED');
 assert.equal(r.versionId,baseline);
 assert.equal(r.followUp,'VERIFY_REMOTE_OFF_FLAGS_AND_D1_BEFORE_PASS');
 assert.equal(m.posted,1);
 assert.equal(m.calls.filter(c=>c.method==='POST'&&c.url.includes('/deployments')).length,1);
 assert.equal(m.calls.filter(c=>c.url.includes('workers.dev')).length,2);
 assert.equal(m.calls.filter(c=>c.url.includes('workers.dev')&&c.headers.Authorization).length,0);
 assert.equal(m.calls.some(c=>c.url.includes('project-love-machine')),false);
 assert.equal(m.calls.some(c=>c.url.includes('/d1/')),false);
});
test('already OFF is idempotent; no deployment POST is sent',async()=>{
 const m=mockCloudflare({active:baseline});
 const r=await restoreDiscordSmoke(input(m));
 assert.equal(r.status,'ALREADY_OFF');
 assert.equal(m.posted,0);
});
test('not expired => no restore unless emergency authorized',async()=>{
 const m=mockCloudflare();
 await rejects(restoreDiscordSmoke(input(m,{nowMs:expiry-10_000})),'RESTORE_DECISION_WAIT');
 assert.equal(m.posted,0);
 const n=mockCloudflare();
 const r=await restoreDiscordSmoke(input(n,{nowMs:expiry-10_000,ownerEmergency:true}));
 assert.equal(r.status,'RESTORED_VERSION_VERIFIED');
 assert.equal(n.posted,1);
});
test('wrong or changed deployment blocks before any write',async()=>{
 const m=mockCloudflare();
 await rejects(restoreDiscordSmoke(input(m,{expectedDeploymentId:second})),'INITIAL_DEPLOYMENT_CHANGED');
 assert.equal(m.posted,0);
 const n=mockCloudflare({concurrent:true});
 await rejects(restoreDiscordSmoke(input(n)),'CONCURRENT_DEPLOYMENT_CHANGED');
 assert.equal(n.posted,0);
});
test('split deployment and unknown version fail closed',async()=>{
 const m=mockCloudflare({split:true});
 await rejects(restoreDiscordSmoke(input(m)),'SPLIT_OR_MISSING_ACTIVE_VERSION');
 assert.equal(m.posted,0);
 const n=mockCloudflare({active:'cfe1d13b-c2ee-4298-9d6f-25478a6e03d8'});
 await rejects(restoreDiscordSmoke(input(n)),'RESTORE_DECISION_BLOCKED');
 assert.equal(n.posted,0);
});
test('D1 substitution, unexpected secret type, and baseline enabled flag block',async()=>{
 for(const mutation of [
  v=>v.map(x=>x.type==='d1'?{...x,database_id:'wrong'}:x),
  v=>v.map(x=>x.name==='DISCORD_PUBLIC_KEY'?{...x,type:'plain_text'}:x),
  v=>v.map(x=>x.name===FLAGS[0]?{...x,text:'true'}:x)
 ]){
  const m=mockCloudflare({oldBindings:mutation(makeBindings('baseline'))});
  await assert.rejects(restoreDiscordSmoke(input(m)),RestoreBlocked);
  assert.equal(m.posted,0);
 }
});
test('restoration refuses duplicated or shadowed LOOP_DB binding before POST',async()=>{
 for(const extra of [
  {name:'LOOP_DB',type:'plain_text',text:'shadow'},
  {name:'LOOP_DB',type:'secret_text'},
  {name:'LOOP_DB',type:'d1',database_id:DISCORD_SMOKE_TARGET.databaseId}
 ]){
  const m=mockCloudflare({oldBindings:[...makeBindings('baseline'),extra]});
  await rejects(restoreDiscordSmoke(input(m)),'DISCORD_D1_BINDING_MISMATCH_baseline');
  assert.equal(m.posted,0);
 }
});
test('smoke cap/flags/deadline must match exact guard',async()=>{
 for(const mutation of [
  v=>v.map(x=>x.name==='SWARM_DAILY_CALL_CAP'?{...x,text:'18'}:x),
  v=>v.map(x=>x.name===FLAGS[0]?{...x,text:'false'}:x),
  v=>v.map(x=>x.name==='SWARM_SMOKE_EXPIRES_AT'?{...x,text:'0'}:x)
 ]){
  const m=mockCloudflare({smokeBindings:mutation(makeBindings('smoke'))});
  await assert.rejects(restoreDiscordSmoke(input(m)),RestoreBlocked);
  assert.equal(m.posted,0);
 }
});
test('HTTP error or ambiguous POST is never retried',async()=>{
 const m=mockCloudflare({failPost:true});
 await rejects(restoreDiscordSmoke(input(m)),'CLOUDFLARE_REQUEST_UNCERTAIN');
 assert.equal(m.posted,1);
});
test('post-restore receipt mismatch blocks without a second POST',async()=>{
 const m=mockCloudflare({wrongReceipt:true});
 await rejects(restoreDiscordSmoke(input(m)),'POST_RESTORE_DEPLOYMENT_RECEIPT_MISMATCH');
 assert.equal(m.posted,1);
});
test('post-deployment wrong version remains unverified and is not retried',async()=>{
 const m=mockCloudflare({postWrong:true});
 await rejects(restoreDiscordSmoke(input(m)),'POST_RESTORE_VERSION_UNVERIFIED');
 assert.equal(m.posted,1);
});
test('post-restore unsigned Discord gate is mandatory',async()=>{
 const m=mockCloudflare({healthStatus:200});
 await rejects(restoreDiscordSmoke(input(m)),'POST_RESTORE_SECURITY_GATE_FAILED');
 assert.equal(m.posted,1);
});
test('missing credentials or adapter never passes',async()=>{
 assert.throws(()=>createDiscordCloudflareClient({token:''}),RestoreBlocked);
 await rejects(restoreDiscordSmoke(input(mockCloudflare(),{client:{}})),'CLIENT_INCOMPLETE');
});

test('Cloudflare API first deployment is active even if later item has newer timestamp',async()=>{
 const m=mockCloudflare({extraLaterDeployment:true});
 const r=await restoreDiscordSmoke(input(m));
 assert.equal(r.status,'RESTORED_VERSION_VERIFIED');
 assert.equal(m.posted,1);
});
test('stale restore authorization blocks before any network call, even for emergency',async()=>{
 for(const nowMs of [expiry+20*60*1000+1, expiry+7*24*60*60*1000]){
  const m=mockCloudflare();
  await rejects(restoreDiscordSmoke(input(m,{nowMs,ownerEmergency:true})),
   'RESTORE_AUTHORIZATION_STALE_MANUAL_REVIEW_REQUIRED');
  assert.equal(m.calls.length,0);
 }
});
test('far-future emergency request cannot start before an approved smoke window',async()=>{
 const m=mockCloudflare();
 await rejects(restoreDiscordSmoke(input(m,{nowMs:expiry-20*60*1000-1,ownerEmergency:true})),
  'RESTORE_WINDOW_TOO_EARLY');
 assert.equal(m.calls.length,0);
});
test('invalid clock and expiry do not make Cloudflare calls',async()=>{
 for(const nowMs of [NaN,Infinity,'2026-10-13']){
  const m=mockCloudflare();
  await rejects(restoreDiscordSmoke(input(m,{nowMs})),'RESTORE_TIME_UNVERIFIED');
  assert.equal(m.calls.length,0);
 }
});
