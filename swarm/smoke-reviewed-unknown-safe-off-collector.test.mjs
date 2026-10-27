import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReviewedUnknownSafeOff} from './smoke-reviewed-unknown-safe-off-collector.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
import {EXACT_REVIEW_STATEMENT} from './smoke-owner-approval.mjs';
const NOW=Date.UTC(2026,9,25,10,0);
const BASELINE='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const row={
 status:'unknown',calls_used:1,cycles:1,stop_requested:0,active_slot:null,
 last_error:'MODEL_OUTCOME_UNKNOWN',created_at:1792838702623,
 updated_at:1792838752941,history_length:2,checkpoint_length:0
};
const opts=()=>({
 primaryReadToken:'fake-primary-read-token',watchdogReadToken:'fake-watchdog-read-token',
 d1ReadToken:'fake-d1-read-token',nowMs:NOW,clock:()=>NOW
});
function mock({daily=0,extraUnknown=0,changedRow={},flagOn=null,armed=false,
 ownerLogin='ikkinotako2-sketch',mutatingRows=false,showSecrets=true}={}){
 const requests=[];let swarmSnapshots=0;
 const ok=result=>({ok:true,status:200,json:async()=>({success:true,result})});
 const bindings=[
  {type:'d1',name:'LOOP_DB',database_id:DISCORD_SMOKE_TARGET.databaseId},
  ...FLAGS.map(name=>({type:'plain_text',name,text:name===flagOn?'true':'false'}))
 ];
 const watchBindings=[
  {type:'plain_text',name:'WATCHDOG_ARMED',text:armed?'true':'false'},
  {type:'plain_text',name:'WATCHDOG_APPROVAL',text:'NOT_APPROVED'},
  ...['WATCHDOG_BASELINE_VERSION','WATCHDOG_SMOKE_VERSION',
    'WATCHDOG_EXPECTED_DEPLOYMENT_ID','WATCHDOG_EXPIRES_AT']
   .map(name=>({type:'plain_text',name,text:'UNSET'}))
 ];
 const fetchImpl=async(url,request={})=>{
  const method=request.method||'GET';requests.push({url,method,body:request.body||''});
  if(url.includes('/d1/database/')){
   assert.equal(method,'POST');
   const sql=JSON.parse(request.body).sql;
   assert.match(sql,/^SELECT /);
   assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i);
   if(sql.includes('FROM swarm_budget_days'))return ok([{success:true,results:[{reserved:daily}]}]);
   if(sql.includes("WHERE status='unknown'"))return ok([{success:true,results:[{...row,...changedRow}]}]);
   if(sql.includes('FROM relay_loop_jobs'))return ok([{success:true,results:[{active_jobs:0}]}]);
   if(sql.includes('FROM swarm_jobs')){
    swarmSnapshots++;
    return ok([{success:true,results:[{
     active_jobs:mutatingRows&&swarmSnapshots>1?1:0,
     unknown_jobs:1+extraUnknown,pending_stop:0
    }]}]);
   }
   throw Error('not allowed SQL');
  }
  if(url.includes('/issues/comments/6384216446'))
   return {ok:true,status:200,json:async()=>({
    id:6384216446,html_url:'https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/issues/14#issuecomment-6384216446',
    user:{login:ownerLogin},author_association:'OWNER',
    body:EXACT_REVIEW_STATEMENT,created_at:'2026-10-24T12:28:53Z'
   })};
  if(url.endsWith('/deployments'))
   return ok({deployments:[{id:'544c4b60-4fb3-4611-a8bc-4e9a026522e1',
    versions:[{percentage:100,version_id:BASELINE}]}]});
  if(url.endsWith('/versions/'+BASELINE))
   return ok({id:BASELINE,resources:{bindings}});
  if(url.endsWith('/settings'))
   return ok(url.includes('independent-watchdog')?{bindings:watchBindings}:{bindings});
  if(url.endsWith('/schedules'))return ok({schedules:[{cron:'* * * * *'}]});
  if(url.endsWith('/secrets'))return ok(showSecrets?[
   {name:'WATCHDOG_RESTORE_TOKEN',type:'secret_text',text:'never-print'},
   {name:'WATCHDOG_D1_READ_TOKEN',type:'secret_text',text:'never-print'}
  ]:[]);
  throw Error('unexpected request');
 };
 return {fetchImpl,requests};
}
test('real-scope GET and SELECT-only collection yields advisory safe-OFF, never release',async()=>{
 const m=mock();const r=await collectReviewedUnknownSafeOff({...opts(),fetchImpl:m.fetchImpl,githubFetchImpl:m.fetchImpl});
 assert.equal(r.status,'SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN');
 assert.equal(r.authorizesLiveActions,false);
 assert.equal(r.accountWideFreeNeurons,'UNVERIFIED');
 assert.equal(r.source,'GET_AND_SELECT_ONLY_NONATOMIC_SNAPSHOT');
 assert.equal(m.requests.filter(q=>q.url.includes('/d1/database/')).length,6);
 assert.equal(m.requests.filter(q=>q.url.includes('/issues/comments/')).length,1);
 assert.equal(m.requests.filter(q=>q.method==='GET'&&q.url.includes('/workers/scripts/')).length,6);
 for(const request of m.requests){
  assert.equal(request.url.includes('/ai/run'),false);
  if(request.url.includes('workers/scripts/'))assert.equal(request.method,'GET');
  assert.equal(request.url.includes('project-love-machine'),false);
 }
 for(const secret of ['fake-primary-read-token','fake-watchdog-read-token','fake-d1-read-token','never-print'])
  assert.equal(JSON.stringify(r).includes(secret),false);
});
test('budget reservation, second UNKNOWN or changed historical row cannot pass',async()=>{
 for(const mode of [{daily:1},{extraUnknown:1},{changedRow:{updated_at:row.updated_at+1}}]){
  const m=mock(mode),r=await collectReviewedUnknownSafeOff({...opts(),fetchImpl:m.fetchImpl,githubFetchImpl:m.fetchImpl});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.authorizesLiveActions,false);
 }
});
test('watchdog, baseline flags, owner proof and D1 races must fail closed',async()=>{
 for(const mode of [
  {flagOn:'SWARM_RUNNER_ENABLED'},{armed:true},{showSecrets:false},
  {ownerLogin:'attacker'},{mutatingRows:true}
 ]){
  const m=mock(mode),r=await collectReviewedUnknownSafeOff({...opts(),fetchImpl:m.fetchImpl,githubFetchImpl:m.fetchImpl});
  assert.equal(r.status,'BLOCKED',JSON.stringify(mode));
  assert.equal(r.authorizesLiveActions,false);
 }
});
test('bad or missing credentials initiate zero remote calls',async()=>{
 const m=mock();
 const r=await collectReviewedUnknownSafeOff({...opts(),d1ReadToken:null,fetchImpl:m.fetchImpl,githubFetchImpl:m.fetchImpl});
 assert.equal(r.status,'BLOCKED');assert.equal(m.requests.length,0);
});

test('stale collection and caller-forged timestamp must fail closed',async()=>{
 const start=mock();
 const rejectStart=await collectReviewedUnknownSafeOff({...opts(),
  clock:()=>NOW+6*60*1000,fetchImpl:start.fetchImpl,githubFetchImpl:start.fetchImpl});
 assert.equal(rejectStart.reason,'START_CLOCK_OR_EVIDENCE_STALE');
 assert.equal(start.requests.length,0);
 const later=mock();let n=0;
 const rejectEnd=await collectReviewedUnknownSafeOff({...opts(),
  clock:()=>++n===1?NOW:NOW+6*60*1000,
  fetchImpl:later.fetchImpl,githubFetchImpl:later.fetchImpl});
 assert.equal(rejectEnd.reason,'READ_ONLY_EVIDENCE_EXPIRED_DURING_COLLECTION');
 assert.equal(rejectEnd.authorizesLiveActions,false);
});
