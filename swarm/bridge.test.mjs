import test from 'node:test';
// Exercise the independent smoke rollback eligibility guard in existing offline CI.
import './smoke-restore-guard.test.mjs';
import './smoke-restore-executor.test.mjs';
import assert from 'node:assert/strict';
import {swarmModeEnabled,isSwarmRoute,runExclusiveScheduledTick} from './bridge.mjs';
import worker,{handleLoopCommand} from '../worker-loop.mjs';
const flags={SWARM_API_ENABLED:'true',SWARM_RUNNER_ENABLED:'true',SWARM_EXECUTION_APPROVED:'true',SWARM_EXCLUSIVE_MODE:'true'};
test('the four opt-in switches are required',()=>{assert.equal(swarmModeEnabled(flags),true);for(const key of Object.keys(flags))assert.equal(swarmModeEnabled({...flags,[key]:'false'}),false)});
test('swarm path routing is exact',()=>{assert.equal(isSwarmRoute('/command-center/swarm/'),true);assert.equal(isSwarmRoute('/command-center/api/swarm/overview'),true);assert.equal(isSwarmRoute('/command-center/api/start'),false)});
test('no swarm inference when feature is disabled',async()=>{let calls=0;const result=await runExclusiveScheduledTick({...flags,SWARM_EXCLUSIVE_MODE:'false'},{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});assert.equal(result.status,'idle');assert.equal(calls,0)});
test('one legacy job blocks the swarm even when the first Cron result is idle',async()=>{let calls=0;const env={...flags,LOOP_DB:{prepare:()=>({bind:()=>({first:async()=>({active_jobs:1})})})}};const result=await runExclusiveScheduledTick(env,{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});assert.equal(result.reason,'LEGACY_JOB_ACTIVE');assert.equal(calls,0)});
test('confirmed empty legacy queue permits one swarm step',async()=>{let calls=0;const env={...flags,LOOP_DB:{prepare:()=>({bind:()=>({first:async()=>({active_jobs:0})})})}};const result=await runExclusiveScheduledTick(env,{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});assert.equal(result.source,'swarm');assert.equal(calls,1)});

test('queued legacy Cron result takes priority over swarm inference',async()=>{
 let calls=0;
 const result=await runExclusiveScheduledTick(flags,{runLegacy:async()=>({status:'queued'}),runSwarm:async()=>{calls++;return {status:'queued'}}});
 assert.equal(result.source,'legacy');assert.equal(calls,0);
});
test('unreadable legacy D1 status blocks swarm without inference',async()=>{
 let calls=0;
 const env={...flags,LOOP_DB:{prepare:()=>({bind:()=>({first:async()=>({active_jobs:'0'})})})}};
 const result=await runExclusiveScheduledTick(env,{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});
 assert.equal(result.reason,'LEGACY_STATE_UNVERIFIED');assert.equal(calls,0);
});
test('legacy failure stops before any subsequent swarm call',async()=>{
 let calls=0;
 await assert.rejects(()=>runExclusiveScheduledTick(flags,{runLegacy:async()=>{throw Error('legacy unavailable')},runSwarm:async()=>{calls++}}),/legacy unavailable/);
 assert.equal(calls,0);
});

test('owner slash loop refuses new 2-role tasks in exclusive six-role mode',async()=>{
 const user='123456789012345678';
 const env={...flags,DISCORD_ALLOWED_USER_ID:user,LOOP_DB:{prepare(){}},AI:{run(){}}};
 const reply=await handleLoopCommand({member:{user:{id:user}},data:{name:'loop'}},env);
 assert.match(reply,/排他運転中/);
});
test('production entrypoint never exposes six-role portal when API flag is absent',async()=>{
 const url='https://steep-glitter-b5cddiscord-ai-relay-lab.ikkinotako2.workers.dev/command-center/swarm/';
 const r=await worker.fetch(new Request(url),{},null);
 assert.equal(r.status,503);
});
test('enabled private six-role portal still redirects anonymous visitors to owner login',async()=>{
 const url='https://steep-glitter-b5cddiscord-ai-relay-lab.ikkinotako2.workers.dev/command-center/swarm/';
 const env={SWARM_API_ENABLED:'true',DASHBOARD_ENABLED:'true',
  DISCORD_ALLOWED_USER_ID:'123456789012345678',LOOP_DB:{prepare(){}},
  DISCORD_OAUTH_CLIENT_SECRET:'test-secret-only-placeholder-long-enough',
  DASHBOARD_COOKIE_KEY:'test-only-private-cookie-value-long-enough'};
 const r=await worker.fetch(new Request(url),env,null);
 assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/command-center/login');
});

test('six-call smoke test requires an explicit near-term absolute deadline',()=>{
 const now=Date.now();
 const smoke={...flags,SWARM_DAILY_CALL_CAP:'6'};
 assert.equal(swarmModeEnabled(smoke,now),false,'missing deadline must fail closed');
 assert.equal(swarmModeEnabled({...smoke,SWARM_SMOKE_EXPIRES_AT:'nonsense'},now),false);
 assert.equal(swarmModeEnabled({...smoke,SWARM_SMOKE_EXPIRES_AT:String(now-1000)},now),false);
 assert.equal(swarmModeEnabled({...smoke,SWARM_SMOKE_EXPIRES_AT:String(now+21*60*1000)},now),false);
 assert.equal(swarmModeEnabled({...smoke,SWARM_SMOKE_EXPIRES_AT:String(now+12*60*1000)},now),true);
 assert.equal(swarmModeEnabled({...smoke,SWARM_SMOKE_EXPIRES_AT:String(now+12*60*1000)},now+12*60*1000),false);
});
test('an expired six-call smoke approval cannot schedule any further agent step',async()=>{
 const now=Date.now(),expired={...flags,SWARM_DAILY_CALL_CAP:'6',SWARM_SMOKE_EXPIRES_AT:String(now-1)};
 let calls=0;
 const result=await runExclusiveScheduledTick(expired,{
  runLegacy:async()=>({status:'idle'}),
  runSwarm:async()=>{calls++;return {status:'queued'};}
 });
 assert.equal(result.source,'legacy');
 assert.equal(result.status,'idle');
 assert.equal(calls,0);
});
