import test from 'node:test';
import assert from 'node:assert/strict';
import {swarmModeEnabled,isSwarmRoute,runExclusiveScheduledTick} from './bridge.mjs';
const flags={SWARM_API_ENABLED:'true',SWARM_RUNNER_ENABLED:'true',SWARM_EXECUTION_APPROVED:'true',SWARM_EXCLUSIVE_MODE:'true'};
test('the four opt-in switches are required',()=>{assert.equal(swarmModeEnabled(flags),true);for(const key of Object.keys(flags))assert.equal(swarmModeEnabled({...flags,[key]:'false'}),false)});
test('swarm path routing is exact',()=>{assert.equal(isSwarmRoute('/command-center/swarm/'),true);assert.equal(isSwarmRoute('/command-center/api/swarm/overview'),true);assert.equal(isSwarmRoute('/command-center/api/start'),false)});
test('no swarm inference when feature is disabled',async()=>{let calls=0;const result=await runExclusiveScheduledTick({...flags,SWARM_EXCLUSIVE_MODE:'false'},{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});assert.equal(result.status,'idle');assert.equal(calls,0)});
test('one legacy job blocks the swarm even when the first Cron result is idle',async()=>{let calls=0;const env={...flags,LOOP_DB:{prepare:()=>({first:async()=>({active_jobs:1})})}};const result=await runExclusiveScheduledTick(env,{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});assert.equal(result.reason,'LEGACY_JOB_ACTIVE');assert.equal(calls,0)});
test('confirmed empty legacy queue permits one swarm step',async()=>{let calls=0;const env={...flags,LOOP_DB:{prepare:()=>({first:async()=>({active_jobs:0})})}};const result=await runExclusiveScheduledTick(env,{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});assert.equal(result.source,'swarm');assert.equal(calls,1)});

test('queued legacy Cron result takes priority over swarm inference',async()=>{
 let calls=0;
 const result=await runExclusiveScheduledTick(flags,{runLegacy:async()=>({status:'queued'}),runSwarm:async()=>{calls++;return {status:'queued'}}});
 assert.equal(result.source,'legacy');assert.equal(calls,0);
});
test('unreadable legacy D1 status blocks swarm without inference',async()=>{
 let calls=0;
 const env={...flags,LOOP_DB:{prepare:()=>({first:async()=>({active_jobs:'0'})})}};
 const result=await runExclusiveScheduledTick(env,{runLegacy:async()=>({status:'idle'}),runSwarm:async()=>{calls++;return {status:'queued'}}});
 assert.equal(result.reason,'LEGACY_STATE_UNVERIFIED');assert.equal(calls,0);
});
test('legacy failure stops before any subsequent swarm call',async()=>{
 let calls=0;
 await assert.rejects(()=>runExclusiveScheduledTick(flags,{runLegacy:async()=>{throw Error('legacy unavailable')},runSwarm:async()=>{calls++}}),/legacy unavailable/);
 assert.equal(calls,0);
});
