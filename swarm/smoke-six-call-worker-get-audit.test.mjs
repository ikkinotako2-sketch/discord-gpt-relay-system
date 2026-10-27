import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDiscordWorkerSafeOffGet,DISCORD_BASELINE_PIN,DISCORD_WATCHDOG_NAME}
 from './smoke-six-call-worker-get-audit.mjs';
import {DISCORD_SMOKE_TARGET as T,FLAGS} from './smoke-restore-guard.mjs';

const now=Date.UTC(2026,9,27,2,0);
const deploymentId='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const otherVersion='3245153e-3281-48e8-a625-0a951d989501';
const root='https://api.cloudflare.com/client/v4/accounts/'+T.accountId+'/workers/scripts/';
const baselineBindings=()=>[
 {name:'LOOP_DB',type:'d1',database_id:T.databaseId},
 ...FLAGS.map(name=>({name,type:'plain_text',text:'false'})),
 {name:'PRIVATE_CONFIGURATION',type:'plain_text',text:'NEVER_LEAK_VALUE'}
];
const wdBindings=()=>[
 {name:'WATCHDOG_ARMED',type:'plain_text',text:'false'},
 {name:'WATCHDOG_APPROVAL',type:'plain_text',text:'NOT_APPROVED'},
 ...['WATCHDOG_BASELINE_VERSION','WATCHDOG_SMOKE_VERSION',
 'WATCHDOG_EXPECTED_DEPLOYMENT_ID','WATCHDOG_EXPIRES_AT']
 .map(name=>({name,type:'plain_text',text:'UNSET'}))
];
function mock({mutate=()=>null,throwOn='',httpError='',unexpectedResult=false}={}){
 const requests=[];let deployCount=0;
 const fetchImpl=async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);
  assert.ok(url.startsWith(root));
  assert.ok(opts.headers.Authorization.startsWith('Bearer '));
  requests.push(url);
  if(throwOn&&url.includes(throwOn))throw Error('simulated network failure');
  if(httpError&&url.includes(httpError))return{
   status:403,ok:false,json:async()=>({success:false})};
  const path=url.slice(root.length);
  let result;
  if(path===T.worker+'/deployments'){
   deployCount++;
   result={deployments:[{
    id:deploymentId,versions:[{percentage:100,version_id:DISCORD_BASELINE_PIN}]
   }]};
  }else if(path===T.worker+'/settings')
   result={bindings:baselineBindings()};
  else if(path===T.worker+'/versions/'+DISCORD_BASELINE_PIN)
   result={id:DISCORD_BASELINE_PIN,resources:{bindings:baselineBindings()}};
  else if(path===DISCORD_WATCHDOG_NAME+'/settings')
   result={bindings:wdBindings()};
  else if(path===DISCORD_WATCHDOG_NAME+'/schedules')
   result={schedules:[{cron:'* * * * *'}]};
  else if(path===DISCORD_WATCHDOG_NAME+'/secrets')
   result=[{name:'WATCHDOG_RESTORE_TOKEN'},{name:'WATCHDOG_D1_READ_TOKEN'}];
  else throw Error('unexpected-url: '+url);
  if(unexpectedResult&&path===T.worker+'/settings')
   return {status:200,ok:true,json:async()=>({success:false,result})};
  const modified=mutate(path,result,{deployCount});
  return {status:200,ok:true,json:async()=>({success:true,result:modified??result})};
 };
 return {requests,fetchImpl};
}
function options(f){return{
 primaryReadToken:'test-primary-read-only-token',
 watchdogReadToken:'test-watchdog-read-only-token',
 fetchImpl:f.fetchImpl,clock:()=>now
};}
test('GET-only exact baseline and parked Watchdog creates NON-authorizing review',async()=>{
 const f=mock();
 const r=await collectDiscordWorkerSafeOffGet(options(f));
 assert.equal(r.status,'WORKER_AND_WATCHDOG_PARKED_GET_REVIEW_ONLY');
 assert.equal(r.trafficPercentage,100);
 assert.equal(r.allFourSwarmFlagsOffObserved,true);
 assert.equal(r.watchdogArmed,false);
 assert.equal(r.signedDiscord401Verified,false);
 assert.equal(r.independentRollbackLiveTested,false);
 assert.equal(r.cloudflareD1JobsRead,false);
 assert.equal(r.authorizesDeployment,false);
 assert.equal(r.authorizesInference,false);
 assert.equal(f.requests.length,7);
 assert.equal(f.requests.every(url=>url.startsWith(root)),true);
 assert.equal(JSON.stringify(r).includes('NEVER_LEAK_VALUE'),false);
 assert.equal(JSON.stringify(r).includes('test-primary-read-only-token'),false);
});
test('wrong or split Worker traffic versions always fail closed',async()=>{
 for(const versions of [
  [{percentage:50,version_id:DISCORD_BASELINE_PIN},
   {percentage:50,version_id:otherVersion}],
  [{percentage:100,version_id:otherVersion}],
  [{percentage:99,version_id:DISCORD_BASELINE_PIN}],
  [],null
 ]){
  const f=mock({mutate:(path,body)=>path===T.worker+'/deployments'?
   {deployments:[{id:deploymentId,versions}]}:null});
  const r=await collectDiscordWorkerSafeOffGet(options(f));
  assert.equal(r.status,'BLOCKED');
 }
});
test('deployment change between two GET snapshots invalidates evidence',async()=>{
 const f=mock({mutate:(path,body,{deployCount})=>{
  if(path===T.worker+'/deployments'&&deployCount===2)
   return {deployments:[{id:'11111111-1111-4111-8111-111111111111',
    versions:[{percentage:100,version_id:DISCORD_BASELINE_PIN}]}]};
  return null;
 }});
 const r=await collectDiscordWorkerSafeOffGet(options(f));
 assert.equal(r.reason,'PRIMARY_DEPLOYMENT_CHANGED_DURING_GET_AUDIT');
});
test('old version metadata and live binding differences are blocked',async()=>{
 for(const patch of [
  {id:otherVersion},
  {resources:{bindings:null}},
  {resources:{bindings:[...baselineBindings(),{name:'SHADOW_DB',type:'d1',
   database_id:T.databaseId}]}}
 ]){
  const f=mock({mutate:(path,body)=>path.includes('/versions/')?{...body,...patch}:null});
  assert.equal((await collectDiscordWorkerSafeOffGet(options(f))).status,'BLOCKED');
 }
});
test('all four flag changes, conflicting duplicates and secret shadow fail',async()=>{
 for(const bindings of [
  [...baselineBindings(),{name:FLAGS[0],type:'plain_text',text:'true'}],
  baselineBindings().map(x=>x.name===FLAGS[3]?{...x,text:'true'}:x),
  baselineBindings().map(x=>x.name===FLAGS[1]?{...x,type:'secret_text'}:x),
  [...baselineBindings(),{name:'LOOP_DB',type:'plain_text',text:'shadow'}],
  baselineBindings().map(x=>x.name==='LOOP_DB'?{...x,database_id:'wrong'}:x),
  [...baselineBindings(),{name:'SHADOW_DB',type:'d1',database_id:T.databaseId}]
 ]){
  const f=mock({mutate:(path,body)=>
   path===T.worker+'/settings'?{bindings}:null});
  assert.equal((await collectDiscordWorkerSafeOffGet(options(f))).status,'BLOCKED');
 }
});
test('all Watchdog armed/approved, wrong deadline, wrong schedule remain BLOCKED',async()=>{
 for(const change of [
  {name:'WATCHDOG_ARMED',text:'EXPLICIT_DISCORD_SMOKE_RESTORE_ONCE'},
  {name:'WATCHDOG_APPROVAL',text:'RESTORE-DISCORD-SMOKE-BASELINE-ONCE'},
  {name:'WATCHDOG_EXPIRES_AT',text:String(now+5*60000)},
  {name:'WATCHDOG_SMOKE_VERSION',text:otherVersion}
 ]){
  const f=mock({mutate:(path,body)=>path===DISCORD_WATCHDOG_NAME+'/settings'?
   {bindings:body.bindings.map(x=>x.name===change.name?{...x,text:change.text}:x)}:null});
  assert.equal((await collectDiscordWorkerSafeOffGet(options(f))).status,'BLOCKED');
 }
 for(const schedules of [[],[{cron:'0 * * * *'}],
  [{cron:'* * * * *'},{cron:'* * * * *'}],null]){
  const f=mock({mutate:(path)=>path===DISCORD_WATCHDOG_NAME+'/schedules'?
   {schedules}:null});
  assert.equal((await collectDiscordWorkerSafeOffGet(options(f))).status,'BLOCKED');
 }
});
test('Watchdog secret names must be exactly one each, never copied',async()=>{
 for(const secrets of [null,[],[{name:'WATCHDOG_RESTORE_TOKEN'}],
  [{name:'WATCHDOG_RESTORE_TOKEN'},{name:'WATCHDOG_RESTORE_TOKEN'},
   {name:'WATCHDOG_D1_READ_TOKEN'}]]){
  const f=mock({mutate:path=>path===DISCORD_WATCHDOG_NAME+'/secrets'?secrets:null});
  const r=await collectDiscordWorkerSafeOffGet(options(f));
  assert.equal(r.status,'BLOCKED');
 }
});
test('network failures, unauthenticated Cloudflare GET and malformed envelope fail',async()=>{
 for(const bad of ['deployments','/settings','/schedules','/secrets']){
  const f=mock({throwOn:bad});
  assert.equal((await collectDiscordWorkerSafeOffGet(options(f))).status,'BLOCKED');
 }
 const m=mock({unexpectedResult:true});
 assert.equal((await collectDiscordWorkerSafeOffGet(options(m))).status,'BLOCKED');
 const x=mock({httpError:'deployments'});
 assert.equal((await collectDiscordWorkerSafeOffGet(options(x))).status,'BLOCKED');
});
test('missing or short tokens prevent every Cloudflare request',async()=>{
 const f=mock();
 for(const patch of [
  {primaryReadToken:''},{primaryReadToken:'abc'},
  {watchdogReadToken:null},{fetchImpl:null},
  {clock:()=>0}
 ]){
  const r=await collectDiscordWorkerSafeOffGet({...options(f),...patch});
  assert.equal(r.status,'BLOCKED');
 }
 assert.equal(f.requests.length,0);
});
test('slow GET and clock rollback invalidate otherwise clean remote evidence',async()=>{
 for(const end of [now+6*60000,now-1]){
  const f=mock();let calls=0;
  const r=await collectDiscordWorkerSafeOffGet({...options(f),
   clock:()=>++calls===1?now:end});
  assert.equal(r.reason,'WORKER_GET_EVIDENCE_STALE');
 }
});
test('no unverified caller boolean turns read result into rollback authority',async()=>{
 const f=mock();
 const r=await collectDiscordWorkerSafeOffGet({...options(f),
  liveRollbackVerified:true,ownerApproved:true,modelPermissionVerified:true,
  authorizesInference:true});
 assert.equal(r.authorizesInference,false);
 assert.equal(r.independentRollbackLiveTested,false);
 assert.equal(r.accountWideNeuronsVerified,false);
});
