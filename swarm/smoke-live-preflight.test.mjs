import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDiscordSmokePreflight,LIVE_READINESS_GATES} from './smoke-live-preflight.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
const now=Date.UTC(2026,9,13,12,0,0);
const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83',
 smoke='3245153e-3281-48e8-a625-0a951d989501',
 deployment='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const evidence=()=>({
 target:DISCORD_SMOKE_TARGET,checkedAt:now-30_000,
 versions:{baseline,smoke,deployment,active:baseline},
 remoteBindings:[
  {type:'d1',name:'LOOP_DB',database_id:DISCORD_SMOKE_TARGET.databaseId},
  ...FLAGS.map(name=>({type:'plain_text',name,text:'false'}))
 ],
 jobs:{legacyActive:0,swarmActive:0,unknownJobs:0,pendingStop:0},
 githubActiveRuns:0,
 account:{plan:'free',cronTriggers:2,neuronsUsed:400,
  neuronQuota:10000,utcDay:'2026-10-13',usageCheckedAt:now-20_000,
  usageSource:'cloudflare_workers_ai_dashboard',conservativeSixCallReservation:700,
  unrelatedAiJobsIdle:true
 },
 deadlineMs:now+10*60*1000,
 gates:Object.fromEntries(LIVE_READINESS_GATES.map(k=>[k,true]))
});
const assess=(overrides={})=>assessDiscordSmokePreflight({...evidence(),...overrides},now);
const blocks=(state,reason)=>{assert.equal(state.status,'BLOCKED',JSON.stringify(state));assert.equal(state.authorizesLiveActions,false);assert.ok(state.blockers.includes(reason),JSON.stringify(state));};
test('all evidence produces only owner review, NEVER permission to start',()=>{
 const s=assess();assert.equal(s.status,'OWNER_REVIEW_REQUIRED');
 assert.equal(s.authorizesLiveActions,false);
 assert.ok(s.blockers.includes('REALTIME_QUOTA_NOT_RESERVED'));
});
test('default absent evidence BLOCKED',()=>blocks(assessDiscordSmokePreflight({},now),'WRONG_OR_UNVERIFIED_DISCORD_RESOURCES'));
test('wrong Worker, account, or D1 never passes',()=>{
 for(const key of ['accountId','worker','databaseId'])
  blocks(assess({target:{...DISCORD_SMOKE_TARGET,[key]:'unrelated'}}),'WRONG_OR_UNVERIFIED_DISCORD_RESOURCES');
});
test('stale or future snapshots reject',()=>{
 blocks(assess({checkedAt:now-6*60*1000}),'PREFLIGHT_SNAPSHOT_STALE');
 blocks(assess({checkedAt:now+1000}),'PREFLIGHT_SNAPSHOT_STALE');
});
test('wrong, missing, split or still-smoke active versions are unverified',()=>{
 for(const changed of [{active:smoke},{smoke:baseline},{deployment:'junk'},{active:null}])
  blocks(assess({versions:{...evidence().versions,...changed}}),'BASELINE_OR_SMOKE_VERSIONS_UNVERIFIED');
});
test('ON flag, duplicate, secret masquerade, wrong D1 all block',()=>{
 for(const key of FLAGS){
  const bindings=evidence().remoteBindings.map(b=>b.name===key?{...b,text:'true'}:b);
  blocks(assess({remoteBindings:bindings}),'SWARM_FLAG_NOT_OFF_'+key);
 }
 blocks(assess({remoteBindings:[...evidence().remoteBindings,{name:FLAGS[0],type:'plain_text',text:'false'}]}),'SWARM_FLAG_NOT_OFF_'+FLAGS[0]);
 blocks(assess({remoteBindings:evidence().remoteBindings.map(b=>b.name===FLAGS[0]?{...b,type:'secret_text'}:b)}),'SWARM_FLAG_NOT_OFF_'+FLAGS[0]);
 blocks(assess({remoteBindings:evidence().remoteBindings.map(b=>b.type==='d1'?{...b,database_id:'other'}:b)}),'DISCORD_D1_BINDING_UNVERIFIED');
});
test('shadowed or duplicate LOOP_DB binding fails closed',()=>{
 const bindings=evidence().remoteBindings;
 for(const extra of [
  {type:'plain_text',name:'LOOP_DB',text:'shadow'},
  {type:'secret_text',name:'LOOP_DB'},
  {type:'d1',name:'LOOP_DB',database_id:DISCORD_SMOKE_TARGET.databaseId}
 ])blocks(assess({remoteBindings:[...bindings,extra]}),'DISCORD_D1_BINDING_UNVERIFIED');
});
test('any legacy, swarm, UNKNOWN or pending STOP count nonzero blocks',()=>{
 for(const k of ['legacyActive','swarmActive','unknownJobs','pendingStop']){
  blocks(assess({jobs:{...evidence().jobs,[k]:1}}),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
  blocks(assess({jobs:{...evidence().jobs,[k]:null}}),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
 }
});
test('unknown or active GitHub Actions blocks',()=>{
 blocks(assess({githubActiveRuns:1}),'GITHUB_ACTIONS_IN_PROGRESS_OR_UNVERIFIED');
 blocks(assess({githubActiveRuns:'0'}),'GITHUB_ACTIONS_IN_PROGRESS_OR_UNVERIFIED');
});
test('Paid account, full Cron capacity, unknown Cron count cannot meet Free requirement',()=>{
 blocks(assess({account:{...evidence().account,plan:'paid'}}),'FREE_PLAN_NOT_VERIFIED');
 blocks(assess({account:{...evidence().account,cronTriggers:5}}),'FREE_CRON_SLOT_UNAVAILABLE_OR_UNKNOWN');
 blocks(assess({account:{...evidence().account,cronTriggers:null}}),'FREE_CRON_SLOT_UNAVAILABLE_OR_UNKNOWN');
});
test('stale, non-dashboard, wrong UTC day, and insufficient Neurons fail closed',()=>{
 for(const changed of [
  {utcDay:'2026-10-12'},{usageSource:'billable_usage_api'},{usageCheckedAt:now-360000},{neuronsUsed:10001},{neuronQuota:0}
 ])blocks(assess({account:{...evidence().account,...changed}}),'CURRENT_ACCOUNT_WIDE_NEURON_USAGE_UNVERIFIED');
 blocks(assess({account:{...evidence().account,neuronsUsed:9900,conservativeSixCallReservation:700}}),'SIX_CALL_FREE_BUDGET_NOT_SUPPORTED');
});
test('unrelated Workers AI running or uncertain => fail',()=>{
 blocks(assess({account:{...evidence().account,unrelatedAiJobsIdle:null}}),'UNRELATED_AI_USAGE_NOT_EXCLUDED');
 blocks(assess({account:{...evidence().account,unrelatedAiJobsIdle:false}}),'UNRELATED_AI_USAGE_NOT_EXCLUDED');
});
test('smoke deadline exceeds 20m / expired / invalid => fail',()=>{
 for(const deadlineMs of [now-1,now+21*60*1000,NaN,'bad'])
  blocks(assess({deadlineMs}),'SMOKE_EXPIRY_NOT_BOUNDED');
});
test('each live safety control must be independently proven',()=>{
 for(const key of LIVE_READINESS_GATES){
  const gates={...evidence().gates,[key]:false};
  blocks(assess({gates}),'UNVERIFIED_'+key.toUpperCase());
 }
});
test('multiple missing conditions reported without mutating input',()=>{
 const input=evidence();input.account.plan='paid';input.jobs.unknownJobs=2;
 const snap=JSON.stringify(input),a=assessDiscordSmokePreflight(input,now);
 assert.equal(a.status,'BLOCKED');assert.ok(a.blockers.length>=2);
 assert.equal(JSON.stringify(input),snap);
});
test('incorrect clock can never authorize review',()=>{
 blocks(assessDiscordSmokePreflight(evidence(),0),'CURRENT_CLOCK_UNVERIFIED');
});

const reviewTime=Date.UTC(2026,9,25,1);
const createdTime=Date.UTC(2026,9,24,11,50);
function reviewed(){
 const x=evidence();
 x.checkedAt=reviewTime-30000;x.deadlineMs=reviewTime+600000;
 x.account={...x.account,utcDay:'2026-10-25',usageCheckedAt:reviewTime-10000};
 x.jobs.unknownJobs=1;
 x.historicalUnknown={
   rows:[{status:'unknown',last_error:'MODEL_OUTCOME_UNKNOWN',calls_used:1,cycles:1,active_slot:null,
     stop_requested:0,created_at:createdTime,updated_at:createdTime+10000,history_length:2,checkpoint_length:0}],
   review:{kind:'OWNER_REVIEWED_UNCERTAIN_NO_RETRY',reviewedAt:createdTime+20000,createdAt:createdTime,
     updatedAt:createdTime+10000,callsUsed:1,error:'MODEL_OUTCOME_UNKNOWN',
     ownerApprovalReference:'https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/issues/14#issuecomment-123'},
   dailyReserved:0,dailyCap:6,ownerCommentVerified:true};
 return x;
}
test('reviewed historical unknown remains visible with NO live authorization',()=>{
 const x=reviewed(),r=assessDiscordSmokePreflight(x,reviewTime);
 assert.equal(x.jobs.unknownJobs,1);
 assert.equal(r.status,'OWNER_REVIEW_REQUIRED');
 assert.equal(r.authorizesLiveActions,false);
 assert.ok(r.blockers.includes('HISTORICAL_UNKNOWN_PRESERVED_RUNTIME_REVIEW_NOT_WIRED'));
});
test('owner comment URL alone cannot pass (unverified identity)',()=>{
 const x=reviewed();x.historicalUnknown.ownerCommentVerified=false;
 blocks(assessDiscordSmokePreflight(x,reviewTime),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
});
test('missing real reviewed historical record blocks',()=>{
 const x=reviewed();x.historicalUnknown.rows=[];
 blocks(assessDiscordSmokePreflight(x,reviewTime),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
});
test('same UTC day blocks even with correct owner review',()=>{
 const x=reviewed(),time=Date.UTC(2026,9,24,20);
 x.checkedAt=time-5000;x.account.utcDay='2026-10-24';x.account.usageCheckedAt=time-3000;
 x.deadlineMs=time+600000;
 blocks(assessDiscordSmokePreflight(x,time),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
});
test('new day local reservations not zero blocks',()=>{
 const x=reviewed();x.historicalUnknown.dailyReserved=1;
 blocks(assessDiscordSmokePreflight(x,reviewTime),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
});
test('active job or additional unknown blocks even if historical record reviewed',()=>{
 for(const key of ['swarmActive','unknownJobs']){
  const x=reviewed();x.jobs[key]=key==='unknownJobs'?2:1;
  blocks(assessDiscordSmokePreflight(x,reviewTime),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
 }
});
test('historical record changed from owner review blocks',()=>{
 const x=reviewed();x.historicalUnknown.rows[0].updated_at++;
 blocks(assessDiscordSmokePreflight(x,reviewTime),'ACTIVE_UNKNOWN_OR_STOP_PENDING_JOBS');
});
