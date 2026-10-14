import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDiscordSmokeReadiness} from './smoke-readonly-collector.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smoke='3245153e-3281-48e8-a625-0a951d989501';
const deployment='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const now=Date.UTC(2026,9,13,12,0);
const good=()=>({
 cloudflareToken:'fake-cf-read-token',d1ReadToken:'fake-d1-read-token',
 baselineVersion:baseline,smokeVersion:smoke,nowMs:now
});
function mock({active=baseline,activeActions=0,d1Unknown=0,d1Active=0,
 githubMalformed=false,readFailure=false,wrongD1=false}={}){
 const calls=[];
 const envelope=result=>({ok:true,status:200,json:async()=>({success:true,result})});
 const fetchImpl=async(url,req={})=>{
  calls.push({url,method:req.method||'GET',body:req.body||'',headers:req.headers||{}});
  const method=req.method||'GET';
  if(url.includes('/actions/runs?')){
   const status=new URL(url).searchParams.get('status');
   return {ok:true,status:200,json:async()=>({total_count:status==='in_progress'?(githubMalformed?'0':activeActions):0,workflow_runs:[]})};
  }
  if(url.includes('.workers.dev/'))return {status:method==='POST'?401:200,
   text:async()=> 'Discord GPT Relay gpt-oss command-center ready.'};
  if(url.endsWith('/deployments')&&method==='GET')
   return envelope({deployments:[{id:deployment,created_on:'2026-10-13T11:00:00Z',
    versions:[{percentage:100,version_id:active}]}]});
  if(url.endsWith('/versions/'+active))
   return envelope({id:active,resources:{bindings:[
    {name:'LOOP_DB',type:'d1',database_id:wrongD1?'WRONG':DISCORD_SMOKE_TARGET.databaseId},
    ...FLAGS.map(name=>({name,type:'plain_text',text:'false'})),
    {name:'DASHBOARD_COOKIE_KEY',type:'secret_text',text:'SECRET_SHOULD_NEVER_LEAK'},
    {name:'PRIVATE_ENV',type:'plain_text',text:'PRIVATE_TEXT_NOT_FOR_REPORT'}
   ]}});
  if(url.includes('/d1/database/')){
   if(readFailure)return {ok:false,status:403,json:async()=>({success:false,result:null})};
   assert.equal(method,'POST');
   const {sql}=JSON.parse(req.body);
   assert.match(sql,/^SELECT /);assert.doesNotMatch(sql,/\b(UPDATE|INSERT|DELETE|DROP|ALTER)\b/i);
   const swarm=sql.includes('FROM swarm_jobs');
   return envelope([{success:true,results:[swarm?{
    active_jobs:d1Active,unknown_jobs:d1Unknown,pending_stop:0
   }:{active_jobs:0}]}]);
  }
  throw new Error('Unexpected request '+method+' '+url);
 };
 return {fetchImpl,calls};
}
test('read-only collector gathers exact target and never touches mutations or AI',async()=>{
 const m=mock();const r=await collectDiscordSmokeReadiness({...good(),fetchImpl:m.fetchImpl});
 assert.equal(r.status,'BLOCKED');assert.equal(r.authorizesLiveActions,false);
 assert.equal(r.evidence.versions.active,baseline);
 assert.equal(r.evidence.versions.deployment,deployment);
 assert.equal(r.evidence.jobs.legacyActive,0);
 assert.equal(r.evidence.jobs.swarmActive,0);
 assert.equal(r.evidence.githubActiveRuns,0);
 assert.equal(r.evidence.gates.unsignedDiscordSignatureRejects,true);
 const serialized=JSON.stringify(r);
 for(const secret of ['SECRET_SHOULD_NEVER_LEAK','PRIVATE_TEXT_NOT_FOR_REPORT','fake-cf-read-token','fake-d1-read-token'])
  assert.equal(serialized.includes(secret),false);
 assert.equal(m.calls.filter(c=>c.url.includes('/d1/database/')).length,2);
 assert.equal(m.calls.filter(c=>c.url.includes('api.github.com')).length,5);
 assert.equal(m.calls.filter(c=>c.method==='POST'&&c.url.includes('/deployments')).length,0);
 assert.equal(m.calls.some(c=>/workers-ai|project-love-machine|api\/inference/.test(c.url)),false);
 assert.equal(m.calls.filter(c=>c.url.includes('workers.dev')).length,2);
});
test('missing token is blocked; no Cloudflare external requests',async()=>{
 const m=mock();
 const r=await collectDiscordSmokeReadiness({...good(),cloudflareToken:null,d1ReadToken:null,fetchImpl:m.fetchImpl});
 assert.ok(r.blockers.includes('CLOUDFLARE_READ_CREDENTIAL_MISSING'));
 assert.ok(r.blockers.includes('DISCORD_D1_READ_CREDENTIAL_MISSING'));
 assert.equal(m.calls.every(x=>x.url.includes('api.github.com')),true);
});
test('current smoke version fails baseline-only preflight',async()=>{
 const m=mock({active:smoke});
 const r=await collectDiscordSmokeReadiness({...good(),fetchImpl:m.fetchImpl});
 assert.ok(r.blockers.includes('BASELINE_OR_SMOKE_VERSIONS_UNVERIFIED'));
 assert.equal(r.authorizesLiveActions,false);
});
test('concurrent GitHub Actions detected even when other calls succeed',async()=>{
 const m=mock({activeActions:2});
 const r=await collectDiscordSmokeReadiness({...good(),fetchImpl:m.fetchImpl});
 assert.equal(r.evidence.githubActiveRuns,2);
 assert.ok(r.blockers.includes('GITHUB_ACTIONS_IN_PROGRESS_OR_UNVERIFIED'));
});
test('malformed GitHub response does not become zero jobs',async()=>{
 const m=mock({githubMalformed:true});
 const r=await collectDiscordSmokeReadiness({...good(),fetchImpl:m.fetchImpl});
 assert.equal(r.evidence.githubActiveRuns,null);
 assert.ok(r.blockers.includes('GITHUB_ACTIVE_WORKFLOWS_UNVERIFIED'));
});
test('D1 UNKNOWN and active counts separately block',async()=>{
 const m=mock({d1Unknown:2,d1Active:1});
 const r=await collectDiscordSmokeReadiness({...good(),fetchImpl:m.fetchImpl});
 assert.equal(r.evidence.jobs.unknownJobs,2);
 assert.ok(r.blockers.includes('ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS'));
});
test('D1 read failure does not cause clean-state success',async()=>{
 const m=mock({readFailure:true});
 const r=await collectDiscordSmokeReadiness({...good(),fetchImpl:m.fetchImpl});
 assert.equal(r.evidence.jobs,null);
 assert.ok(r.blockers.includes('DISCORD_D1_READ_FAILED'));
});
test('wrong D1 binding blocks even if job counts are zero',async()=>{
 const m=mock({wrongD1:true});
 const r=await collectDiscordSmokeReadiness({...good(),fetchImpl:m.fetchImpl});
 assert.ok(r.blockers.includes('DISCORD_D1_BINDING_UNVERIFIED'));
});
test('invalid pinned versions make no HTTP calls',async()=>{
 const m=mock();
 const r=await collectDiscordSmokeReadiness({...good(),smokeVersion:baseline,fetchImpl:m.fetchImpl});
 assert.equal(r.reason,'DISTINCT_PINNED_WORKER_VERSIONS_REQUIRED');
 assert.equal(m.calls.length,0);
});
