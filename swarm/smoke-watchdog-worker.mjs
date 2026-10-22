// SEPARATE, STAGED Cloudflare Free watchdog Worker. NOT deployed or imported by production.
// Independent Cron plus DO alarm share the SAME durable one-shot restore latch.
import {runIndependentWatchdogTick} from './smoke-watchdog-core.mjs';
import {DISCORD_SMOKE_TARGET} from './smoke-restore-guard.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARM='EXPLICIT_DISCORD_SMOKE_RESTORE_ONCE';
const APPROVAL='RESTORE-DISCORD-SMOKE-BASELINE-ONCE';
const PREARM='PREARM_TO_CAPTURE_SMOKE_DEPLOYMENT';
function exactTarget(env){
 return env?.WATCHDOG_ARMED===ARM && env?.WATCHDOG_APPROVAL===APPROVAL &&
  env.WATCHDOG_ACCOUNT_ID===DISCORD_SMOKE_TARGET.accountId &&
  env.WATCHDOG_WORKER===DISCORD_SMOKE_TARGET.worker &&
  env.WATCHDOG_D1_ID===DISCORD_SMOKE_TARGET.databaseId &&
  uuid.test(env.WATCHDOG_BASELINE_VERSION||'') &&
  uuid.test(env.WATCHDOG_SMOKE_VERSION||'') &&
  env.WATCHDOG_BASELINE_VERSION!==env.WATCHDOG_SMOKE_VERSION &&
  (uuid.test(env.WATCHDOG_EXPECTED_DEPLOYMENT_ID||'')||
   env.WATCHDOG_EXPECTED_DEPLOYMENT_ID===PREARM);
}
function validExpiry(env,now){
 const string=String(env?.WATCHDOG_EXPIRES_AT??'');
 if(!/^\d{13}$/.test(string)||!Number.isSafeInteger(now))return null;
 const deadline=Number(string),remaining=deadline-now;
 return Number.isSafeInteger(deadline)&&remaining>0&&remaining<=20*60*1000?deadline:null;
}
export async function armWatchdogAlarm(env,{nowMs=Date.now()}={}){
 if(!exactTarget(env))return {status:'BLOCKED',reason:'ALARM_SCOPE_OR_OWNER_APPROVAL_INVALID'};
 // Never report an independent safety mechanism as ARMED when either runtime
 // credential is absent. This only checks presence, NOT scope or entitlement.
 if(typeof env.WATCHDOG_RESTORE_TOKEN!=='string'||env.WATCHDOG_RESTORE_TOKEN.length<8||
    typeof env.WATCHDOG_D1_READ_TOKEN!=='string'||env.WATCHDOG_D1_READ_TOKEN.length<8)
  return {status:'BLOCKED',reason:'ALARM_SCOPED_CREDENTIALS_MISSING'};
 const deadline=validExpiry(env,nowMs);
 if(deadline===null)return {status:'BLOCKED',reason:'ALARM_DEADLINE_NOT_WITHIN_20_MINUTES'};
 if(!env.WATCHDOG_ONCE?.idFromName||!env.WATCHDOG_ONCE?.get)
  return {status:'BLOCKED',reason:'ALARM_DURABLE_BINDING_MISSING'};
 try{
  const smokeVersion=env.WATCHDOG_SMOKE_VERSION;
  const id=env.WATCHDOG_ONCE.idFromName('discord-smoke:'+smokeVersion+':'+deadline);
  const res=await env.WATCHDOG_ONCE.get(id).fetch('https://watchdog.internal/arm',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({smokeVersion,expiryMs:deadline})
  });
  if(res.status!==200)return {status:'BLOCKED',reason:'ALARM_ARMING_NOT_CONFIRMED'};
  const result=await res.json();
  return result?.armed===true?{status:'ARMED',expiresAt:deadline}
   :{status:'BLOCKED',reason:'ALARM_ARMING_NOT_CONFIRMED'};
 }catch{return {status:'BLOCKED',reason:'ALARM_ARMING_REQUEST_UNCERTAIN'};}
}
export class SmokeRestoreOnce {
 constructor(ctx,env){
  this.ctx=ctx;this.env=env;
  this.clock=()=>Date.now();
  this.tick=runIndependentWatchdogTick;
 }
 async claim(smokeVersion,expiryMs){
  return this.ctx.storage.transaction(async tx=>{
   if(await tx.get('attempted'))return false;
   // A Cron tick must not send any restore POST if its independent alarm
   // was never successfully persisted and verified. An alarm is a backup,
   // not a proof of real-time delivery.
   const armed=await tx.get('armed');
   const confirmed=await tx.get('alarm_confirmed');
   if(armed?.smokeVersion!==smokeVersion||armed?.expiryMs!==expiryMs||
      confirmed?.smokeVersion!==smokeVersion||confirmed?.expiryMs!==expiryMs)
    return false;
   await tx.put('attempted',{smokeVersion,expiryMs});
   return true;
  });
 }
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(request.method!=='POST'||!['/claim','/arm'].includes(path))
   return new Response('Not found',{status:404});
  let payload;
  try{payload=await request.json();}catch{return new Response('Invalid',{status:400});}
  if(!exactTarget(this.env)||!uuid.test(payload?.smokeVersion||'') ||
     payload.smokeVersion!==this.env.WATCHDOG_SMOKE_VERSION ||
     String(payload.expiryMs)!==this.env.WATCHDOG_EXPIRES_AT ||
     !Number.isSafeInteger(payload.expiryMs))
   return new Response('Rejected',{status:403});
  if(path==='/claim'){
   // Write irrevocable marker BEFORE the one allowed Cloudflare restore POST.
   const acquired=await this.claim(payload.smokeVersion,payload.expiryMs);
   return Response.json({claimed:acquired});
  }
  // Programmatic DO alarm is a BACKUP for the separate Cron scheduler. It has
  // at-least-once delivery; ONLY the shared permanent claim prevents duplicates.
  const expiry=validExpiry(this.env,this.clock());
  if(expiry===null||expiry!==payload.expiryMs)
   return new Response('Invalid deadline',{status:403});
  const [attempted,previous,alarm]=await Promise.all([
   this.ctx.storage.get('attempted'),
   this.ctx.storage.get('armed'),
   this.ctx.storage.getAlarm()
  ]);
  if(attempted)return new Response('Already attempted',{status:409});
  if(previous&&(previous.smokeVersion!==payload.smokeVersion||previous.expiryMs!==expiry))
   return new Response('Different smoke already armed',{status:409});
  if(alarm!==null&&alarm!==expiry)return new Response('Conflicting alarm',{status:409});
  if(!previous)await this.ctx.storage.put('armed',{smokeVersion:payload.smokeVersion,expiryMs:expiry});
  if(alarm===null)await this.ctx.storage.setAlarm(expiry);
  // Confirm that the independent DO alarm was genuinely scheduled before
  // allowing either Cron or the alarm handler to claim a deployment attempt.
  if(await this.ctx.storage.getAlarm()!==expiry)
   return new Response('Alarm scheduling unverified',{status:503});
  await this.ctx.storage.put('alarm_confirmed',{smokeVersion:payload.smokeVersion,expiryMs:expiry});
  return Response.json({armed:true});
 }
 async alarm(){
  try{
   const [armed,confirmed]=await Promise.all([
    this.ctx.storage.get('armed'),this.ctx.storage.get('alarm_confirmed')
   ]);
   if(!armed||!confirmed||!exactTarget(this.env)||
      armed.smokeVersion!==this.env.WATCHDOG_SMOKE_VERSION||
      confirmed.smokeVersion!==armed.smokeVersion||confirmed.expiryMs!==armed.expiryMs||
      String(armed.expiryMs)!==this.env.WATCHDOG_EXPIRES_AT)return;
   const nowMs=this.clock();
   if(nowMs<armed.expiryMs)return; // Cron will independently check after expiry.
   const result=await this.tick(this.env,{nowMs,
    claimOnce:()=>this.claim(armed.smokeVersion,armed.expiryMs)});
   // No thrown exception / automatic API retry after ambiguous completion.
   console.log(JSON.stringify({component:'discord_smoke_alarm',status:result.status,
    reason:result.reason||null}));
  }catch{
   console.log('discord_smoke_alarm BLOCKED_DO_NOT_RETRY');
  }
 }
}
export default {
 async fetch(){return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});},
 async scheduled(_event,env,_ctx){
  // Arm the extra alarm ONLY during the approved, bounded smoke window.
  // Before expiry the existing core returns WAIT and makes no Cloudflare API request.
  const arm=await armWatchdogAlarm(env);
  const result=await runIndependentWatchdogTick(env);
  console.log(JSON.stringify({component:'discord_smoke_watchdog',status:result.status,
   reason:result.reason||null,alarm:arm.status}));
 }
};
