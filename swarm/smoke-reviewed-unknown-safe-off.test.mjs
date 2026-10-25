import test from 'node:test';
import assert from 'node:assert/strict';
import {assessReviewedUnknownSafeOff,HISTORICAL_UNKNOWN_FINGERPRINT as F}
 from './smoke-reviewed-unknown-safe-off.mjs';
import {DISCORD_SMOKE_TARGET,FLAGS} from './smoke-restore-guard.mjs';
const now=Date.UTC(2026,9,25,9,0,0);
const original=()=>({...F});
const proof=()=>({
 target:{...DISCORD_SMOKE_TARGET},
 snapshot:{legacyActive:0,swarmActive:0,pendingStop:0,unknownJobs:1},
 rows:[original()],
 ownerCommentVerified:true,
 review:{kind:'OWNER_REVIEWED_UNCERTAIN_NO_RETRY',
  reviewedAt:F.updated_at+200000,createdAt:F.created_at,
  updatedAt:F.updated_at,callsUsed:1,error:'MODEL_OUTCOME_UNKNOWN',
  ownerApprovalReference:'https://github.com/ikkinotako2-sketch/discord-gpt-relay-system/issues/14#issuecomment-6384216446'},
 remoteBindings:[
  {type:'d1',name:'LOOP_DB',database_id:DISCORD_SMOKE_TARGET.databaseId},
  ...FLAGS.map(name=>({name,type:'plain_text',text:'false'}))
 ],
 deployment:{percentage:100,baselineActive:true,deploymentIdVerified:true},
 watchdog:{armed:false,approval:'NOT_APPROVED',parked:true},
 nowMs:now
});
const block=(v,reason)=>{
 const r=assessReviewedUnknownSafeOff(v);
 assert.equal(r.status,'BLOCKED');assert.equal(r.reason,reason);
 assert.equal(r.authorizesLiveActions,false);
};
test('original single historical UNKNOWN may be safely OFF, never an execution permit',()=>{
 const p=proof();const before=JSON.stringify(p);
 const r=assessReviewedUnknownSafeOff(p);
 assert.equal(r.status,'SAFE_OFF_WITH_REVIEWED_HISTORICAL_UNKNOWN');
 assert.equal(r.authorizesLiveActions,false);
 assert.equal(r.authorizesCleanupWrites,false);
 assert.equal(r.preservedUnknownCount,1);
 assert.equal(JSON.stringify(p),before);
});
test('false, missing, or spoofed owner proof fail closed',()=>{
 for(const x of [false,null,undefined]){
  const p=proof();p.ownerCommentVerified=x;
  block(p,'OWNER_IDENTITY_UNVERIFIED');
 }
 const x=proof();x.review.ownerApprovalReference='https://other.example/anything';
 block(x,'OWNER_REVIEW_UNVERIFIED');
});
test('tampered original unknown fingerprint fails closed even if owner review is present',()=>{
 for(const changed of [
  {updated_at:F.updated_at+1},{created_at:F.created_at+1},
  {calls_used:2},{cycles:2},{history_length:3},{checkpoint_length:1},
  {last_error:'MODEL_ERROR'},{status:'completed'},{stop_requested:1},
  {active_slot:1}
 ]){
  const x=proof();x.rows=[{...F,...changed}];
  block(x,'ORIGINAL_UNKNOWN_CHANGED_OR_UNVERIFIED');
 }
 for(const rows of [[],[original(),original()],null]){
  const x=proof();x.rows=rows;block(x,'ORIGINAL_UNKNOWN_CHANGED_OR_UNVERIFIED');
 }
});
test('no active, stop-pending or second UNKNOWN job can be declared safe',()=>{
 for(const [key,count] of [['legacyActive',1],['swarmActive',1],['pendingStop',1],['unknownJobs',2],['unknownJobs',0]]){
  const x=proof();x.snapshot[key]=count;block(x,'ACTIVE_STOP_OR_EXTRA_UNKNOWN_UNVERIFIED');
 }
});
test('release must be pinned to exact Discord-only target, 100% baseline, and D1',()=>{
 for(const key of ['accountId','worker','databaseId']){
  const x=proof();x.target[key]='wrong';block(x,'WRONG_DISCORD_TARGET');
 }
 for(const patch of [{percentage:80},{baselineActive:false},{deploymentIdVerified:false}]){
  const x=proof();x.deployment={...x.deployment,...patch};block(x,'BASELINE_LIVE_100_PERCENT_UNVERIFIED');
 }
 for(const patch of [
  {type:'plain_text',name:'LOOP_DB',text:'fake'},
  {type:'d1',name:'LOOP_DB',database_id:'wrong'}
 ]){
  const x=proof();x.remoteBindings.push(patch);
  block(x,'DEDICATED_D1_BINDING_UNVERIFIED');
 }
});
test('each SWARM flag must be OFF or absent and without shadow bindings',()=>{
 for(const flag of FLAGS){
  for(const change of [{type:'plain_text',text:'true'},{type:'secret_text',text:undefined}]){
   const x=proof();x.remoteBindings=x.remoteBindings.map(b=>b.name===flag?{...b,...change}:b);
   block(x,'SWARM_FLAG_NOT_OFF_'+flag);
  }
  const x=proof();x.remoteBindings.push({name:flag,type:'plain_text',text:'false'});
  block(x,'SWARM_FLAG_NOT_OFF_'+flag);
 }
});
test('watchdog parked, approval not granted, expiry never armed',()=>{
 for(const patch of [{armed:true},{approval:'YES'},{parked:false}]){
  const x=proof();x.watchdog={...x.watchdog,...patch};
  block(x,'WATCHDOG_PARKED_UNVERIFIED');
 }
});
test('stale or same UTC day owner review and invalid clocks rejected',()=>{
 const x=proof();x.nowMs=Date.UTC(2026,9,24,22,0);
 block(x,'OWNER_REVIEW_UNVERIFIED');
 const y=proof();y.nowMs=0;
 block(y,'CLOCK_UNVERIFIED');
});
