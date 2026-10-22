import test from 'node:test';
import assert from 'node:assert/strict';
import {armWatchdogAlarm,SmokeRestoreOnce} from './smoke-watchdog-worker.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
const baseline='18c379e8-e759-4b2f-8300-e7a4c8b39b83';
const smoke='3245153e-3281-48e8-a625-0a951d989501';
const deployment='544c4b60-4fb3-4611-a8bc-4e9a026522e1';
const expiry=Date.UTC(2026,9,13,12,20);
const before=expiry-90_000;
function env(){
 return {
  WATCHDOG_ARMED:'EXPLICIT_DISCORD_SMOKE_RESTORE_ONCE',
  WATCHDOG_APPROVAL:'RESTORE-DISCORD-SMOKE-BASELINE-ONCE',
  WATCHDOG_ACCOUNT_ID:DISCORD_SMOKE_TARGET.accountId,
  WATCHDOG_WORKER:DISCORD_SMOKE_TARGET.worker,
  WATCHDOG_D1_ID:DISCORD_SMOKE_TARGET.databaseId,
  WATCHDOG_BASELINE_VERSION:baseline,
  WATCHDOG_SMOKE_VERSION:smoke,
  WATCHDOG_EXPECTED_DEPLOYMENT_ID:deployment,
  WATCHDOG_EXPIRES_AT:String(expiry),
  WATCHDOG_RESTORE_TOKEN:'test-scoped-restore-token',
  WATCHDOG_D1_READ_TOKEN:'test-scoped-d1-read-token'
 };
}
function object({alarmFails=false,alarmNotScheduled=false,confirmationFails=false}={}){
 const map=new Map();let alarm=null,setCount=0,claimedWrites=0;
 const storage={
  get:async k=>map.get(k),
  put:async(k,v)=>{if(confirmationFails&&k==='alarm_confirmed')throw Error('persistence failed');map.set(k,v);},
  getAlarm:async()=>alarm,
  setAlarm:async t=>{setCount++;if(alarmFails)throw Error('setAlarm failed');if(!alarmNotScheduled)alarm=t;},
  transaction:async cb=>cb({
   get:async k=>map.get(k),
   put:async(k,v)=>{if(k==='attempted')claimedWrites++;map.set(k,v);}
  })
 };
 const cfg=env(),instance=new SmokeRestoreOnce({storage},cfg);
 instance.clock=()=>before;
 // The host passes Request(url, {method,body,...}), not a plain object.
 const realBinding={idFromName:name=>name,get:_=>({fetch:(url,opts)=>instance.fetch(new Request(url,opts))})};
 cfg.WATCHDOG_ONCE=realBinding;
 return {cfg,instance,map,storage,
  get alarm(){return alarm;},get setCount(){return setCount;},get claimedWrites(){return claimedWrites;}};
}
test('prearm before smoke deployment ID exists schedules a durable alarm',async()=>{
 const o=object();o.cfg.WATCHDOG_EXPECTED_DEPLOYMENT_ID='PREARM_TO_CAPTURE_SMOKE_DEPLOYMENT';
 const result=await armWatchdogAlarm(o.cfg,{nowMs:before});
 assert.equal(result.status,'ARMED');
 assert.equal(o.alarm,expiry);
 assert.equal(o.map.get('alarm_confirmed').smokeVersion,smoke);
});
test('Cron prearms DO alarm only when deadline <= 20 minutes and configuration exact',async()=>{
 const o=object();
 const first=await armWatchdogAlarm(o.cfg,{nowMs:before});
 assert.equal(first.status,'ARMED');assert.equal(o.alarm,expiry);
 const second=await armWatchdogAlarm(o.cfg,{nowMs:before+1});
 assert.equal(second.status,'ARMED');assert.equal(o.setCount,1);
 assert.equal(o.map.get('armed').smokeVersion,smoke);
 assert.equal(o.map.get('alarm_confirmed').expiryMs,expiry);
});
test('missing restore or D1 Read credential prevents backup alarm from reporting ARMED',async()=>{
 for(const missing of ['WATCHDOG_RESTORE_TOKEN','WATCHDOG_D1_READ_TOKEN']){
  const o=object();delete o.cfg[missing];
  const result=await armWatchdogAlarm(o.cfg,{nowMs:before});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'ALARM_SCOPED_CREDENTIALS_MISSING');
  assert.equal(o.alarm,null);assert.equal(o.map.has('alarm_confirmed'),false);
 }
});
test('wrong scope, not explicitly armed, distant or expired deadline never create alarm',async()=>{
 for(const mutate of [
  x=>{x.WATCHDOG_ARMED='false';},
  x=>{x.WATCHDOG_D1_ID='other';},
  x=>{x.WATCHDOG_WORKER='another';},
  x=>{x.WATCHDOG_APPROVAL='NOT_APPROVED';}
 ]){
  const o=object();mutate(o.cfg);
  assert.equal((await armWatchdogAlarm(o.cfg,{nowMs:before})).status,'BLOCKED');
  assert.equal(o.alarm,null);assert.equal(o.claimedWrites,0);
 }
 const late=object();
 assert.equal((await armWatchdogAlarm(late.cfg,{nowMs:expiry+1})).status,'BLOCKED');
 const far=object();
 assert.equal((await armWatchdogAlarm(far.cfg,{nowMs:expiry-21*60*1000})).status,'BLOCKED');
});
test('DO alarm cannot run before its expiry',async()=>{
 const o=object();await armWatchdogAlarm(o.cfg,{nowMs:before});
 let calls=0;
 o.instance.tick=async()=>{calls++;throw Error('should not run');};
 await o.instance.alarm();
 assert.equal(calls,0);assert.equal(o.claimedWrites,0);
});
test('DO alarm attempts a single restore across duplicate deliveries; Cron shares same marker',async()=>{
 const o=object();await armWatchdogAlarm(o.cfg,{nowMs:before});
 o.instance.clock=()=>expiry+2_000;
 let network=0,claimedResults=[];
 o.instance.tick=async(_env,{claimOnce})=>{
  if(await claimOnce()){network++;claimedResults.push(true);return {status:'OFF_VERIFIED'};}
  claimedResults.push(false);return {status:'BLOCKED',reason:'ALREADY_ATTEMPTED'};
 };
 await o.instance.alarm();
 await o.instance.alarm();
 assert.equal(network,1);assert.equal(o.claimedWrites,1);
 assert.deepEqual(claimedResults,[true,false]);
 const reply=await o.instance.fetch(new Request('https://watchdog.internal/claim',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({smokeVersion:smoke,expiryMs:expiry})}));
 assert.equal((await reply.json()).claimed,false);
});
test('an unknown API result cannot cause automatic retry even if the alarm fires again',async()=>{
 const o=object();await armWatchdogAlarm(o.cfg,{nowMs:before});o.instance.clock=()=>expiry+10;
 let posts=0;
 o.instance.tick=async(_,{claimOnce})=>{
  if(await claimOnce())posts++;
  return {status:'BLOCKED',reason:'RESTORE_POST_UNCERTAIN'};
 };
 await o.instance.alarm();await o.instance.alarm();
 assert.equal(posts,1);assert.equal(o.claimedWrites,1);
});
test('an alarm from an unarmed or changed config never invokes the restore tick',async()=>{
 const o=object();await armWatchdogAlarm(o.cfg,{nowMs:before});o.instance.clock=()=>expiry+5;
 o.cfg.WATCHDOG_ARMED='false';
 o.instance.tick=()=>{throw Error('should never run');};
 await o.instance.alarm();
 assert.equal(o.claimedWrites,0);
});
test('conflicting alarm cannot be overwritten or silently moved',async()=>{
 const o=object();await armWatchdogAlarm(o.cfg,{nowMs:before});
 o.cfg.WATCHDOG_EXPIRES_AT=String(expiry+6000);
 o.instance.clock=()=>before;
 const r=await o.instance.fetch(new Request('https://watchdog.internal/arm',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({smokeVersion:smoke,expiryMs:expiry+6000})}));
 assert.equal(r.status,409);
 assert.equal(o.alarm,expiry);
});

test('failed, missing or unconfirmed alarm never permits either restore path to claim',async()=>{
 for(const failure of [{alarmFails:true},{alarmNotScheduled:true},{confirmationFails:true}]){
  const o=object(failure);
  const attempt=await armWatchdogAlarm(o.cfg,{nowMs:before});
  assert.equal(attempt.status,'BLOCKED');
  assert.equal(o.map.has('alarm_confirmed'),false);
  let claimed=false;
  const request=()=>new Request('https://watchdog.internal/claim',{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({smokeVersion:smoke,expiryMs:expiry})});
  const res=await o.instance.fetch(request());
  claimed=(await res.json()).claimed;
  assert.equal(claimed,false);
  assert.equal(o.map.has('attempted'),false);
  o.instance.clock=()=>expiry+1;
  let calls=0;
  o.instance.tick=async()=>{calls++;};
  await o.instance.alarm();
  assert.equal(calls,0,'an unconfirmed deadline must never trigger any restore');
 }
});
test('an unrelated persisted deadline receipt cannot enable a restore',async()=>{
 const o=object();
 await armWatchdogAlarm(o.cfg,{nowMs:before});
 o.map.set('alarm_confirmed',{smokeVersion:smoke,expiryMs:expiry+5000});
 const res=await o.instance.fetch(new Request('https://watchdog.internal/claim',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({smokeVersion:smoke,expiryMs:expiry})}));
 assert.equal((await res.json()).claimed,false);
 assert.equal(o.map.has('attempted'),false);
});
