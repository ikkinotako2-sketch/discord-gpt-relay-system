import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePreservedUnknownReadOnly,DISCORD_UNKNOWN_OWNER_COMMENT}
 from './smoke-historical-evidence-readonly.mjs';
import {collectDiscordSmokeReadiness} from './smoke-readonly-collector.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
import {EXACT_REVIEW_STATEMENT} from './smoke-owner-approval.mjs';

const now=Date.UTC(2026,9,25,10,0);
const BASE='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const SMOKE='3245153e-3281-48e8-a625-0a951d989501';
const DEPLOY='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const ROW=Object.freeze({
 status:'unknown',calls_used:1,cycles:1,stop_requested:0,active_slot:null,
 last_error:'MODEL_OUTCOME_UNKNOWN',created_at:1792838702623,
 updated_at:1792838752941,history_length:2,checkpoint_length:0
});
const realComment=()=>({
 id:6384216446,html_url:DISCORD_UNKNOWN_OWNER_COMMENT,
 user:{login:'ikkinotako2-sketch'},author_association:'OWNER',
 body:EXACT_REVIEW_STATEMENT,created_at:'2026-10-24T12:28:53Z'
});
function mock({oldRow={...ROW},dailyReserved=0,unknownRows,comment=realComment(),
 extraUnknown=0}={}){
 const requests=[];
 const envelope=result=>({ok:true,status:200,json:async()=>({success:true,result})});
 const fetchImpl=async(url,options={})=>{
  const method=options.method||'GET';
  const data={url,method,body:options.body||''};
  requests.push(data);
  if(url.includes('/d1/database/')){
   assert.equal(method,'POST'); // REST transport only, still SELECT SQL.
   const sql=JSON.parse(options.body).sql;
   assert.match(sql,/^SELECT /);
   assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|CREATE)\b/i);
   if(sql.includes('FROM swarm_budget_days'))
    return envelope([{success:true,results:[{reserved:dailyReserved}]}]);
   if(sql.includes("WHERE status='unknown'"))
    return envelope([{success:true,results:unknownRows??[oldRow]}]);
   if(sql.includes('FROM swarm_jobs'))
    return envelope([{success:true,results:[{
     active_jobs:0,unknown_jobs:1+extraUnknown,pending_stop:0
    }]}]);
   if(sql.includes('FROM relay_loop_jobs'))
    return envelope([{success:true,results:[{active_jobs:0}]}]);
   throw Error('Unexpected SQL');
  }
  if(url.includes('/issues/comments/6384216446'))return {ok:true,status:200,json:async()=>comment};
  if(url.includes('/actions/runs?'))return {ok:true,status:200,json:async()=>({total_count:0})};
  if(url.includes('.workers.dev/'))return {
   ok:true,status:method==='POST'?401:200,
   text:async()=>'Discord GPT Relay gpt-oss command-center ready.'
  };
  if(url.endsWith('/deployments'))return envelope({deployments:[{
   id:DEPLOY,versions:[{percentage:100,version_id:BASE}]
  }]});
  if(url.endsWith('/versions/'+BASE))return envelope({id:BASE,resources:{bindings:[
   {name:'LOOP_DB',type:'d1',database_id:DISCORD_SMOKE_TARGET.databaseId},
   ...FLAGS.map(name=>({name,type:'plain_text',text:'false'})),
   {name:'PRIVATE_SETTING',type:'plain_text',text:'DO_NOT_LEAK'}
  ]}});
  throw Error('Unexpected URL '+url);
 };
 return {fetchImpl,requests};
}
const readOpts=fetchImpl=>({d1ReadToken:'fake-d1-token',fetchImpl,nowMs:now});
test('reads exactly two hard-coded SELECT queries and no user data',async()=>{
 const m=mock(); const r=await capturePreservedUnknownReadOnly(readOpts(m.fetchImpl));
 assert.equal(r.utcDay,'2026-10-25');assert.equal(r.dailyReserved,0);
 assert.deepEqual(r.rows,[ROW]);assert.equal(r.authorizesLiveActions,false);
 assert.equal(m.requests.length,2);
 assert.equal(m.requests.some(c=>c.url.includes('/ai/run')),false);
 assert.equal(JSON.stringify(r).includes('fake-d1-token'),false);
});
test('rejects changed UNKNOWN fingerprint without reclassifying it',async()=>{
 for(const change of [
  {updated_at:ROW.updated_at+1},{created_at:ROW.created_at+1},
  {calls_used:2},{history_length:3},{last_error:'LEASE_EXPIRED'},
  {status:'completed'},{active_slot:1},{checkpoint_length:1}
 ]){
  const m=mock({oldRow:{...ROW,...change}});
  await assert.rejects(capturePreservedUnknownReadOnly(readOpts(m.fetchImpl)),
   /HISTORICAL_UNKNOWN_ROW_CHANGED_OR_UNVERIFIED/);
 }
});
test('rejects nonunique records, missing or malformed today budget',async()=>{
 for(const rows of [[],[ROW,ROW]]){
  const m=mock({unknownRows:rows});
  await assert.rejects(capturePreservedUnknownReadOnly(readOpts(m.fetchImpl)),
   /HISTORICAL_UNKNOWN_NOT_EXACTLY_ONE/);
 }
 for(const count of [-1,'0',null,NaN]){
  const m=mock({dailyReserved:count});
  await assert.rejects(capturePreservedUnknownReadOnly(readOpts(m.fetchImpl)),
   /CURRENT_UTC_DAY_BUDGET_UNVERIFIED/);
 }
});
test('invalid credentials and clock prevent even SELECT transport',async()=>{
 const m=mock();
 await assert.rejects(capturePreservedUnknownReadOnly({...readOpts(m.fetchImpl),d1ReadToken:null}),/INPUT_UNVERIFIED/);
 await assert.rejects(capturePreservedUnknownReadOnly({...readOpts(m.fetchImpl),nowMs:0}),/INPUT_UNVERIFIED/);
 assert.equal(m.requests.length,0);
});
test('collector verifies actual owner comment and immutable row, but never authorizes launch',async()=>{
 const m=mock();
 const result=await collectDiscordSmokeReadiness({
  cloudflareToken:'fake-cloudflare-read-token',
  d1ReadToken:'fake-d1-token',baselineVersion:BASE,smokeVersion:SMOKE,
  nowMs:now,fetchImpl:m.fetchImpl
 });
 assert.equal(result.status,'BLOCKED');
 assert.equal(result.authorizesLiveActions,false);
 assert.equal(result.evidence.jobs.unknownJobs,1);
 assert.equal(result.evidence.historicalUnknown.ownerCommentVerified,true);
 assert.equal(result.evidence.historicalUnknown.dailyReserved,0);
 assert.equal(result.evidence.historicalUnknown.review.kind,'OWNER_REVIEWED_UNCERTAIN_NO_RETRY');
 assert.equal(result.blockers.includes('ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS'),false);
 assert.ok(result.blockers.includes('CURRENT_ACCOUNT_WIDE_NEURON_USAGE_UNVERIFIED'));
 const serialized=JSON.stringify(result);
 for(const secret of ['fake-cloudflare-read-token','fake-d1-token','DO_NOT_LEAK'])
  assert.equal(serialized.includes(secret),false);
 assert.equal(m.requests.some(r=>r.url.includes('/ai/run')||r.url.includes('project-love-machine')),false);
 assert.equal(m.requests.filter(r=>r.url.includes('/d1/database/')).length,4);
});
test('spoofed owner or changed D1 evidence never passes the review',async()=>{
 for(const options of [
  {comment:{...realComment(),author_association:'NONE'}},
  {comment:{...realComment(),user:{login:'other-user'}}},
  {comment:{...realComment(),body:'approved to rerun'}},
  {oldRow:{...ROW,updated_at:ROW.updated_at+1}},
  {extraUnknown:1}
 ]){
  const m=mock(options), r=await collectDiscordSmokeReadiness({
   cloudflareToken:'fake-cloudflare-read-token',
   d1ReadToken:'fake-d1-token',baselineVersion:BASE,smokeVersion:SMOKE,
   nowMs:now,fetchImpl:m.fetchImpl
  });
  assert.equal(r.status,'BLOCKED');assert.equal(r.authorizesLiveActions,false);
  assert.equal(r.evidence?.historicalUnknown?.ownerCommentVerified===true,false);
 }
});
