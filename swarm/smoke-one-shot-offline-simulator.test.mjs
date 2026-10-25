import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineOneShot,applyOfflineOneShotEvent,offlineOneShotSummary}
 from './smoke-one-shot-offline-simulator.mjs';
import {HISTORICAL_UNKNOWN_FINGERPRINT as OLD}
 from './smoke-reviewed-unknown-safe-off.mjs';

const now=Date.UTC(2026,9,25,11,0),expiry=now+19*60*1000;
const newRun=()=>createOfflineOneShot({nowMs:now,expiryMs:expiry});
const mock=(kind,rest={})=>({kind,mockEvidence:true,...rest});
function advance(state,kind,at,fields={}){
 return applyOfflineOneShotEvent(state,mock(kind,fields),at);
}
function ready(){
 let s=newRun();
 s=advance(s,'MOCK_WATCHDOG_PREARMED',now+10);
 s=advance(s,'MOCK_NON_SERVING_VERSION_STAGED',now+20);
 s=advance(s,'MOCK_TRAFFIC_SWITCH_CONFIRMED',now+30);
 s=advance(s,'MOCK_NEW_OWNER_OAUTH_CSRF_TASK',now+40);
 assert.equal(s.phase,'OWNER_TASK_AUTHENTICATED');
 return s;
}
test('exact one-time six-claim simulation follows strictly ordered mock receipts',()=>{
 let s=ready();let at=now+50;
 for(let i=0;i<6;i++){
  const before=JSON.stringify(s);
  s=advance(s,'MOCK_MODEL_CLAIM',at++,{index:i});
  assert.equal(s.phase,'MODEL_CLAIMED');
  assert.equal(s.claims,i+1);assert.equal(s.completions,i);
  s=advance(s,'MOCK_MODEL_FINAL',at++,{index:i,finalVerified:true});
  assert.equal(s.completions,i+1);
  assert.equal(s.authorizesLiveActions,false);
  assert.equal(before.includes('OFFLINE_SIMULATION_ONLY'),true);
 }
 assert.equal(s.phase,'SWITCHED_ONCE');
 s=advance(s,'MOCK_BASELINE_RESTORED',at++);
 assert.equal(s.phase,'RESTORE_VERIFIED');
 s=advance(s,'MOCK_WATCHDOG_PARKED',at++);
 assert.equal(s.phase,'COMPLETE');
 assert.deepEqual(offlineOneShotSummary(s),{
  status:'COMPLETE',mockClaims:6,mockCompletions:6,
  oldUnknownPreserved:true,authorizesLiveActions:false,
  warning:'SIMULATION_ONLY_NOT_PRODUCTION_AUTHORIZATION'
 });
});
test('unknown provider outcome is terminal; never attempt or count its completion again',()=>{
 let s=ready();
 s=advance(s,'MOCK_MODEL_CLAIM',now+50,{index:0});
 s=advance(s,'MOCK_PROVIDER_RESULT_UNKNOWN',now+60,{index:0});
 assert.equal(s.phase,'UNCERTAIN_MANUAL_RECOVERY');
 assert.equal(s.claims,1);assert.equal(s.completions,0);
 assert.equal(s.originalUnknownPreserved,true);
 s=advance(s,'MOCK_MODEL_CLAIM',now+70,{index:0});
 assert.equal(s.phase,'BLOCKED');
 assert.equal(s.authorizesLiveActions,false);
});
test('duplicate claim, missing final output or wrong order all block',()=>{
 const s=ready();
 for(const event of [
  mock('MOCK_MODEL_FINAL',{index:0,finalVerified:true}),
  mock('MOCK_MODEL_CLAIM',{index:1}),
  mock('MOCK_BASELINE_RESTORED'),
  {kind:'MOCK_MODEL_CLAIM',index:0,mockEvidence:false},
  mock('PRODUCTION_DEPLOY'),
  null
 ]){
  const out=applyOfflineOneShotEvent(s,event,now+50);
  assert.equal(out.phase,'BLOCKED');
  assert.equal(out.authorizesLiveActions,false);
 }
 const claimed=advance(s,'MOCK_MODEL_CLAIM',now+55,{index:0});
 for(const event of [
  mock('MOCK_MODEL_CLAIM',{index:0}),
  mock('MOCK_MODEL_FINAL',{index:0,finalVerified:false}),
  mock('MOCK_MODEL_FINAL',{index:2,finalVerified:true})
 ]){
  const out=applyOfflineOneShotEvent(claimed,event,now+60);
  assert.equal(out.phase,'BLOCKED');
 }
});
test('cannot model traffic switch without independent prearm and staged version',()=>{
 const s=newRun();
 for(const kind of ['MOCK_TRAFFIC_SWITCH_CONFIRMED','MOCK_MODEL_CLAIM','MOCK_NEW_OWNER_OAUTH_CSRF_TASK']){
  const r=advance(s,kind,now+1,{index:0});
  assert.equal(r.phase,'BLOCKED');
 }
 let x=advance(s,'MOCK_WATCHDOG_PREARMED',now+1);
 x=advance(x,'MOCK_TRAFFIC_SWITCH_CONFIRMED',now+2);
 assert.equal(x.phase,'BLOCKED');
});
test('expiry and backward timestamp never silently reuse a planned stage',()=>{
 const s=ready();
 for(const ts of [now+19*60*1000+1,now+35,-1,NaN]){
  const r=advance(s,'MOCK_MODEL_CLAIM',ts,{index:0});
  assert.equal(r.phase,'BLOCKED');
 }
});
test('bad cap, altered historical UNKNOWN and invalid deadlines are rejected',()=>{
 for(const patch of [
  {maxCalls:7},{maxCalls:0},{expiryMs:now-1},
  {expiryMs:now+21*60*1000},{nowMs:0},
  {previousUnknown:{...OLD,last_error:'SUCCESS'}},
  {previousUnknown:null}
 ]){
  const r=createOfflineOneShot({nowMs:now,expiryMs:expiry,...patch});
  assert.equal(r.phase,'BLOCKED');
  assert.equal(r.authorizesLiveActions,false);
 }
});
test('mock receipts never become an execution authorizer',()=>{
 const s=ready();
 for(let i=0;i<6;i++){
  const claim=advance(s,'MOCK_MODEL_CLAIM',now+100+i*10,{index:i});
  assert.equal(claim.authorizesLiveActions,false);
 }
 const forged=applyOfflineOneShotEvent({...s,authorizesLiveActions:true},
  mock('MOCK_MODEL_CLAIM',{index:0}),now+110);
 assert.equal(forged.phase,'BLOCKED');
 assert.equal(forged.authorizesLiveActions,false);
});

test('independent restore after model UNKNOWN preserves uncertain result, never 6/6',()=>{
 let s=ready();
 s=advance(s,'MOCK_MODEL_CLAIM',now+50,{index:0});
 s=advance(s,'MOCK_PROVIDER_RESULT_UNKNOWN',now+55,{index:0});
 assert.equal(s.phase,'UNCERTAIN_MANUAL_RECOVERY');
 s=advance(s,'MOCK_BASELINE_RESTORED',expiry+1000);
 assert.equal(s.phase,'RESTORE_VERIFIED');
 assert.equal(s.uncertain,true);
 s=advance(s,'MOCK_WATCHDOG_PARKED',expiry+2000);
 assert.equal(s.phase,'RESTORED_WITH_UNKNOWN');
 assert.equal(s.completions,0);
 assert.equal(s.claims,1);
 assert.equal(s.authorizesLiveActions,false);
});
test('in-flight claim interrupted by rollback is unknown, not a successful call',()=>{
 let s=ready();
 s=advance(s,'MOCK_MODEL_CLAIM',now+50,{index:0});
 s=advance(s,'MOCK_BASELINE_RESTORED',now+60);
 assert.equal(s.phase,'RESTORE_VERIFIED');
 assert.equal(s.uncertain,true);
 s=advance(s,'MOCK_WATCHDOG_PARKED',now+70);
 assert.equal(s.phase,'RESTORED_WITH_UNKNOWN');
 assert.equal(s.completions,0);
});
test('early rollback safely ends incomplete without claiming full completion',()=>{
 let s=ready();
 s=advance(s,'MOCK_MODEL_CLAIM',now+50,{index:0});
 s=advance(s,'MOCK_MODEL_FINAL',now+60,{index:0,finalVerified:true});
 assert.equal(s.completions,1);
 s=advance(s,'MOCK_BASELINE_RESTORED',now+70);
 s=advance(s,'MOCK_WATCHDOG_PARKED',now+80);
 assert.equal(s.phase,'RESTORED_INCOMPLETE');
 assert.equal(s.completions,1);
 assert.equal(s.authorizesLiveActions,false);
});
test('stale or duplicate restore receipt never retries a provider-side operation',()=>{
 let s=ready();
 s=advance(s,'MOCK_MODEL_CLAIM',now+50,{index:0});
 s=advance(s,'MOCK_PROVIDER_RESULT_UNKNOWN',now+60,{index:0});
 const over=advance(s,'MOCK_BASELINE_RESTORED',expiry+20*60*1000+1);
 assert.equal(over.phase,'BLOCKED');
 s=advance(s,'MOCK_BASELINE_RESTORED',expiry+1000);
 const duplicate=advance(s,'MOCK_BASELINE_RESTORED',expiry+2000);
 assert.equal(duplicate.phase,'BLOCKED');
 assert.equal(duplicate.authorizesLiveActions,false);
});
