// Separate Cloudflare Free Worker candidate. NOT deployed and never imported by Discord production.
// Requires explicit future owner approval, own Cron, two scoped secrets and Durable Object latch.
import {runIndependentWatchdogTick} from './smoke-watchdog-core.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class SmokeRestoreOnce {
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/claim')
   return new Response('Not found',{status:404});
  let payload;
  try{payload=await request.json();}catch{return new Response('Invalid',{status:400});}
  if(!uuid.test(payload?.smokeVersion||'')||
     payload.smokeVersion!==this.env.WATCHDOG_SMOKE_VERSION ||
     String(payload.expiryMs)!==this.env.WATCHDOG_EXPIRES_AT ||
     !Number.isSafeInteger(payload.expiryMs))
   return new Response('Rejected',{status:403});
  // One durable atomic claim, committed BEFORE any Cloudflare deployment call.
  // If storage fails, the caller cannot proceed. We deliberately never clear it
  // automatically (including after a timeout, Worker crash, or API ambiguity).
  const acquired=await this.ctx.storage.transaction(async(tx)=>{
   const existing=await tx.get('attempted');
   if(existing)return false;
   await tx.put('attempted',{smokeVersion:payload.smokeVersion,expiryMs:payload.expiryMs});
   return true;
  });
  return Response.json({claimed:acquired});
 }
}
export default {
 async fetch(){return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});},
 async scheduled(_event,env,_ctx){
  const result=await runIndependentWatchdogTick(env);
  // SAFE telemetry only: no token, D1 data, job content or private user IDs.
  console.log(JSON.stringify({component:'discord_smoke_watchdog',status:result.status,
   reason:result.reason||null}));
 }
};
